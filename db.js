// ==============================================================================
// db.js — Supabase JS Client Wrapper tương thích API Prisma
// Truy vấn qua Supabase HTTPS REST API (Hoạt động mượt mà trên mọi mạng IPv4 & IPv6)
// ==============================================================================
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('⚠️  Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong file .env');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Bản SSR có cả schema Prisma và một file SQL dùng snake_case.
// Chọn rõ schema, không sửa hoặc di chuyển dữ liệu đang có.
const snakeSchema = process.env.DB_SCHEMA_STYLE === 'snake';
const junction = snakeSchema ? 'dish_ingredients' : '_DishToIngredient';
const dishColumn = snakeSchema ? 'dish_id' : 'A';
const ingredientColumn = snakeSchema ? 'ingredient_id' : 'B';
function dishFromDb(row) {
  if (!row || !snakeSchema) return row;
  return { ...row, imageUrl: row.image_url, chefId: row.chef_id, _DishToIngredient: row.dish_ingredients };
}
function dishToDb(data) {
  if (!snakeSchema) return data;
  const mapped = { ...data };
  for (const [from, to] of [['imageUrl', 'image_url'], ['chefId', 'chef_id']]) {
    if (from in mapped) { mapped[to] = mapped[from]; delete mapped[from]; }
  }
  return mapped;
}

// =============================================================================
// 1. Model Món Ăn (Dishes)
// =============================================================================
const dish = {
  async findMany({ where = {}, include = {}, orderBy = { id: 'asc' } } = {}) {
    let select = '*';
    if (include.chef && include.ingredients) {
      select = `*, chef:chefs(*), ${junction}(ingredients(*))`;
    } else if (include.chef) {
      select = '*, chef:chefs(*)';
    } else if (include.ingredients) {
      select = `*, ${junction}(ingredients(*))`;
    }

    let query = supabase.from('dishes').select(select);

    // Xử lý tìm kiếm theo tên (insensitive)
    if (where.name?.contains) {
      query = query.ilike('name', `%${where.name.contains}%`);
    }

    // Xử lý sắp xếp
    if (orderBy) {
      const [col, dir] = Object.entries(orderBy)[0];
      query = query.order(col, { ascending: dir === 'asc' });
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map(d => {
      const row = { ...dishFromDb(d) };
      if (row._DishToIngredient) {
        row.ingredients = row._DishToIngredient.map(item => item.ingredients).filter(Boolean);
        delete row._DishToIngredient;
      } else if (include.ingredients && !row.ingredients) {
        row.ingredients = [];
      }
      return row;
    });
  },

  async findUnique({ where = {}, include = {} } = {}) {
    let select = '*';
    if (include.chef && include.ingredients) {
      select = `*, chef:chefs(*), ${junction}(ingredients(*))`;
    } else if (include.chef) {
      select = '*, chef:chefs(*)';
    } else if (include.ingredients) {
      select = `*, ${junction}(ingredients(*))`;
    }

    let query = supabase.from('dishes').select(select);
    if (where.id) query = query.eq('id', where.id);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const row = { ...dishFromDb(data) };
    if (row._DishToIngredient) {
      row.ingredients = row._DishToIngredient.map(item => item.ingredients).filter(Boolean);
      delete row._DishToIngredient;
    } else if (include.ingredients && !row.ingredients) {
      row.ingredients = [];
    }
    return row;
  },

  async create({ data = {} } = {}) {
    const { ingredients, chef, ...dishData } = data;
    if (chef?.connect?.id) {
      dishData.chefId = chef.connect.id;
    }

    const { data: created, error } = await supabase.from('dishes').insert(dishToDb(dishData)).select('*').single();
    if (error) throw error;

    // Liên kết nguyên liệu nhiều-nhiều vào _DishToIngredient (A: dishId, B: ingredientId)
    if (ingredients?.connect && Array.isArray(ingredients.connect)) {
      const links = ingredients.connect.map(ing => ({ [dishColumn]: created.id, [ingredientColumn]: ing.id }));
      if (links.length > 0) {
        try {
          await supabase.from(junction).insert(links).throwOnError();
        } catch (err) {
          await supabase.from('dishes').delete().eq('id', created.id);
          throw err;
        }
      }
    }

    return dishFromDb(created);
  },

  async update({ where = {}, data = {} } = {}) {
    const { ingredients, chef, ...updateData } = data;
    if (chef?.connect?.id) {
      updateData.chefId = chef.connect.id;
    } else if (chef?.disconnect) {
      updateData.chefId = null;
    }

    const { data: updated, error } = await supabase
      .from('dishes')
      .update(dishToDb(updateData))
      .eq('id', where.id)
      .select('*')
      .single();
    if (error) throw error;

    // Cập nhật quan hệ nguyên liệu
    if (ingredients?.set) {
      // Xóa liên kết cũ
      await supabase.from(junction).delete().eq(dishColumn, where.id).throwOnError();
      // Thêm liên kết mới
      const links = ingredients.set.map(ing => ({ [dishColumn]: where.id, [ingredientColumn]: ing.id }));
      if (links.length > 0) {
        await supabase.from(junction).insert(links).throwOnError();
      }
    }

    return dishFromDb(updated);
  },

  async delete({ where = {} } = {}) {
    // Xóa liên kết nguyên liệu trước
    await supabase.from(junction).delete().eq(dishColumn, where.id).throwOnError();
    const { data, error } = await supabase.from('dishes').delete().eq('id', where.id);
    if (error) throw error;
    return { id: where.id };
  }
};

// =============================================================================
// 2. Model Đầu Bếp (Chefs)
// =============================================================================
const chef = {
  async findMany({ orderBy = { id: 'asc' } } = {}) {
    let query = supabase.from('chefs').select('*');
    if (orderBy) {
      const [col, dir] = Object.entries(orderBy)[0];
      query = query.order(col, { ascending: dir === 'asc' });
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async findUnique({ where = {} } = {}) {
    const { data, error } = await supabase.from('chefs').select('*').eq('id', where.id).maybeSingle();
    if (error) throw error;
    return data;
  },

  async create({ data = {} } = {}) {
    const { data: created, error } = await supabase.from('chefs').insert(data).select('*').single();
    if (error) throw error;
    return created;
  },

  async update({ where = {}, data = {} } = {}) {
    const { data: updated, error } = await supabase.from('chefs').update(data).eq('id', where.id).select('*').single();
    if (error) throw error;
    return updated;
  },

  async delete({ where = {} } = {}) {
    const { error } = await supabase.from('chefs').delete().eq('id', where.id);
    if (error) throw error;
    return { id: where.id };
  }
};

// =============================================================================
// 3. Model Nguyên Liệu (Ingredients)
// =============================================================================
const ingredient = {
  async findMany({ orderBy = { id: 'asc' } } = {}) {
    let query = supabase.from('ingredients').select('*');
    if (orderBy) {
      const [col, dir] = Object.entries(orderBy)[0];
      query = query.order(col, { ascending: dir === 'asc' });
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async findUnique({ where = {} } = {}) {
    const { data, error } = await supabase.from('ingredients').select('*').eq('id', where.id).maybeSingle();
    if (error) throw error;
    return data;
  },

  async create({ data = {} } = {}) {
    const { data: created, error } = await supabase.from('ingredients').insert(data).select('*').single();
    if (error) throw error;
    return created;
  },

  async update({ where = {}, data = {} } = {}) {
    const { data: updated, error } = await supabase.from('ingredients').update(data).eq('id', where.id).select('*').single();
    if (error) throw error;
    return updated;
  },

  async delete({ where = {} } = {}) {
    await supabase.from(junction).delete().eq(ingredientColumn, where.id).throwOnError();
    const { error } = await supabase.from('ingredients').delete().eq('id', where.id);
    if (error) throw error;
    return { id: where.id };
  }
};

// =============================================================================
// 4. Model Hồ Sơ Người Dùng (Profiles - Cho Auth)
// =============================================================================
function mapProfileFromDb(row) {
  if (!row) return null;
  return {
    ...row,
    failedLoginAttempts: row.failed_login_attempts ?? row.failedLoginAttempts ?? 0,
    isLocked: row.is_locked ?? row.isLocked ?? false,
    unlockToken: row.unlock_token ?? row.unlockToken ?? null,
    unlockTokenExpires: row.unlock_token_expires ?? row.unlockTokenExpires ?? null,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt
  };
}

function mapProfileToDb(data) {
  if (!data) return {};
  const mapped = { ...data };
  if ('failedLoginAttempts' in mapped) {
    mapped.failed_login_attempts = mapped.failedLoginAttempts;
    delete mapped.failedLoginAttempts;
  }
  if ('isLocked' in mapped) {
    mapped.is_locked = mapped.isLocked;
    delete mapped.isLocked;
  }
  if ('unlockToken' in mapped) {
    mapped.unlock_token = mapped.unlockToken;
    delete mapped.unlockToken;
  }
  if ('unlockTokenExpires' in mapped) {
    mapped.unlock_token_expires = mapped.unlockTokenExpires;
    delete mapped.unlockTokenExpires;
  }
  return mapped;
}

const profile = {
  async findFirst({ where = {} } = {}) {
    if (where.OR) {
      // Hỗ trợ tìm kiếm theo Username HOẶC Email
      for (const cond of where.OR) {
        if (cond.username) {
          const { data, error } = await supabase.from('profiles').select('*').eq('username', cond.username).maybeSingle();
          if (error) throw error;
          if (data) return mapProfileFromDb(data);
        }
        if (cond.email) {
          const { data, error } = await supabase.from('profiles').select('*').eq('email', cond.email).maybeSingle();
          if (error) throw error;
          if (data) return mapProfileFromDb(data);
        }
      }
      return null;
    }

    let query = supabase.from('profiles').select('*');
    if (where.id) query = query.eq('id', where.id);
    if (where.username) query = query.eq('username', where.username);
    if (where.email) query = query.eq('email', where.email);
    if (where.unlockToken) query = query.eq('unlock_token', where.unlockToken);
    if (where.unlockTokenExpires?.gt) {
      query = query.gt('unlock_token_expires', where.unlockTokenExpires.gt.toISOString());
    }

    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw error;
    return mapProfileFromDb(data);
  },

  async create({ data = {} } = {}) {
    const dbData = mapProfileToDb(data);
    const { data: created, error } = await supabase.from('profiles').insert(dbData).select('*').single();
    if (error) throw error;
    return mapProfileFromDb(created);
  },

  async update({ where = {}, data = {} } = {}) {
    const dbData = mapProfileToDb(data);
    const { data: updated, error } = await supabase.from('profiles').update(dbData).eq('id', where.id).select('*').single();
    if (error) throw error;
    return mapProfileFromDb(updated);
  }
};

module.exports = {
  dish,
  chef,
  ingredient,
  profile,
  _supabase: supabase
};
