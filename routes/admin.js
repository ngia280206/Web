const express = require('express');
const { HttpError, id, text, validate, found } = require('../lib/errors');

module.exports = ({ db }) => {
  const router = express.Router();
  const models = { dishes: db.dish, chefs: db.chef, ingredients: db.ingredient };
  const include = { chef: true, ingredients: true };

  async function normalize(resource, body, existing) {
    const data = { ...existing, ...body };
    const errors = [];
    const name = text(data.name);
    if (!name || name.length > 200) errors.push('Tên phải có từ 1 đến 200 ký tự.');
    if (resource !== 'dishes') {
      const key = resource === 'chefs' ? 'specialty' : 'unit';
      const value = text(data[key]);
      if (!value || value.length > 500) errors.push(resource === 'chefs' ? 'Vui lòng nhập chuyên môn đầu bếp (tối đa 500 ký tự).' : 'Vui lòng nhập đơn vị tính (tối đa 500 ký tự).');
      validate(errors);
      return { name, [key]: value };
    }
    const price = Number(data.price);
    if (data.price === '' || data.price == null || !['number', 'string'].includes(typeof data.price) ||
      !Number.isInteger(price) || price < 0 || price > 2147483647) errors.push('Giá phải là số nguyên từ 0 đến 2.147.483.647.');
    const chefId = data.chefId === '' || data.chefId == null ? null : id(data.chefId);
    if (chefId === null && data.chefId !== '' && data.chefId != null) errors.push('Mã đầu bếp không hợp lệ.');
    const ingredientIds = body.ingredientIds !== undefined ? body.ingredientIds : (existing?.ingredients || []).map(item => item.id);
    if (!Array.isArray(ingredientIds) || ingredientIds.some(value => !id(value))) errors.push('Danh sách nguyên liệu không hợp lệ.');
    if (typeof data.available !== 'boolean') errors.push('Trạng thái còn món phải là true hoặc false.');
    const imageUrl = text(data.imageUrl);
    if (imageUrl) {
      try {
        if (!['http:', 'https:'].includes(new URL(imageUrl).protocol)) throw new Error();
      } catch { errors.push('Ảnh phải là URL http hoặc https hợp lệ.'); }
    }
    validate(errors);
    const selected = [...new Set(ingredientIds.map(Number))];
    if (chefId && !await db.chef.findUnique({ where: { id: chefId } })) throw new HttpError(400, 'Đầu bếp không tồn tại.');
    const ingredients = await db.ingredient.findMany({ orderBy: { id: 'asc' } });
    if (selected.some(value => !ingredients.some(item => item.id === value))) throw new HttpError(400, 'Có nguyên liệu không tồn tại.');
    return {
      name, price, description: text(data.description) || null,
      category: text(data.category) || null, imageUrl: imageUrl || null,
      available: data.available,
      chef: chefId ? { connect: { id: chefId } } : { disconnect: true },
      ingredients: existing ? { set: selected.map(value => ({ id: value })) } : { connect: selected.map(value => ({ id: value })) }
    };
  }

  // Cùng một bộ xử lý cho ba tài nguyên; các trường ghi được liệt kê rõ trong normalize.
  for (const [resource, model] of Object.entries(models)) {
    router.get(`/${resource}`, async (req, res) => {
      const items = await model.findMany({ orderBy: { id: 'asc' }, ...(resource === 'dishes' ? { include } : {}) });
      res.json({ items });
    });
    router.get(`/${resource}/:id`, async (req, res) => {
      const itemId = id(req.params.id);
      if (!itemId) throw new HttpError(404, 'Mã dữ liệu không hợp lệ.');
      res.json({ item: found(await model.findUnique({ where: { id: itemId }, ...(resource === 'dishes' ? { include } : {}) })) });
    });
    router.post(`/${resource}`, async (req, res) => {
      const data = await normalize(resource, req.body || {});
      const item = await model.create({ data });
      res.status(201).json({ item, message: 'Thêm thành công.' });
    });
    router.patch(`/${resource}/:id`, async (req, res) => {
      const itemId = id(req.params.id);
      if (!itemId) throw new HttpError(404, 'Mã dữ liệu không hợp lệ.');
      const existing = found(await model.findUnique({ where: { id: itemId }, ...(resource === 'dishes' ? { include } : {}) }));
      const data = await normalize(resource, req.body || {}, existing);
      const item = await model.update({ where: { id: itemId }, data });
      res.json({ item, message: 'Cập nhật thành công.' });
    });
    router.delete(`/${resource}/:id`, async (req, res) => {
      const itemId = id(req.params.id);
      if (!itemId) throw new HttpError(404, 'Mã dữ liệu không hợp lệ.');
      found(await model.findUnique({ where: { id: itemId } }));
      await model.delete({ where: { id: itemId } });
      res.status(204).end();
    });
  }
  return router;
};
