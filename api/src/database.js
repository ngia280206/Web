import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultPath = fileURLToPath(new URL('../data/restaurant.sqlite', import.meta.url));

export function openDatabase(path = defaultPath, { seed = true } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY);
  `);
  if (!db.prepare('SELECT version FROM migrations WHERE version = 1').get()) {
    db.exec(`BEGIN;
      CREATE TABLE dishes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, description TEXT NOT NULL,
        price REAL NOT NULL CHECK(price >= 0), category TEXT NOT NULL,
        available INTEGER NOT NULL CHECK(available IN (0, 1))
      );
      CREATE TABLE chefs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, specialty TEXT NOT NULL);
      CREATE TABLE ingredients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, unit TEXT NOT NULL);
      INSERT INTO migrations(version) VALUES (1);
    COMMIT;`);
  }
  // Seed once per database, never repopulate records intentionally deleted by a user.
  if (seed && !db.prepare('SELECT version FROM migrations WHERE version = 2').get()) {
    db.exec('BEGIN');
    try {
      const dish = db.prepare('INSERT INTO dishes(name, description, price, category, available) VALUES (?, ?, ?, ?, ?)');
      for (const row of [
        ['Cơm tấm sườn bì chả', 'Sườn nướng than hoa, bì trộn thính và chả trứng. Dùng cùng cơm tấm nóng, mỡ hành và nước mắm nhà làm.', 65000, 'Món chính', 1],
        ['Gỏi cuốn tôm thịt', 'Tôm tươi, thịt luộc và rau vườn cuốn trong bánh tráng mỏng. Chấm cùng tương đậu phộng rang thơm.', 45000, 'Khai vị', 1],
        ['Cá kho tộ', 'Cá kho chậm trong niêu đất với nước màu dừa, tiêu xanh và hành tím. Vị đậm đà của bữa cơm nhà.', 95000, 'Món chính', 1],
        ['Canh chua cá', 'Nước canh thanh chua từ me, cà chua và thơm, thêm rau om cùng ngò gai. Một hương vị miền Nam thân thuộc.', 75000, 'Món canh', 1],
        ['Chè sen long nhãn', 'Hạt sen bùi mềm ôm trong long nhãn, nấu cùng nước đường phèn thanh nhẹ. Dùng mát.', 35000, 'Tráng miệng', 1],
        ['Bánh xèo miền Tây', 'Vỏ bánh giòn thơm nghệ, nhân tôm thịt và giá đỗ. Ăn cùng rau sống theo mùa và nước mắm chua ngọt.', 70000, 'Món chính', 0],
      ]) dish.run(...row);
      const chef = db.prepare('INSERT INTO chefs(name, specialty) VALUES (?, ?)');
      chef.run('Nguyễn Thanh An', 'Ẩm thực Nam Bộ & món kho truyền thống');
      chef.run('Trần Minh Hương', 'Món cuốn & rau theo mùa');
      chef.run('Lê Hoài Phương', 'Chè & món ngọt Việt');
      const ingredient = db.prepare('INSERT INTO ingredients(name, unit) VALUES (?, ?)');
      for (const row of [['Gạo tấm', 'kg'], ['Sườn heo', 'kg'], ['Tôm tươi', 'kg'], ['Hạt sen', 'g'], ['Rau thơm', 'bó'], ['Nước mắm', 'ml']]) ingredient.run(...row);
      db.prepare('INSERT INTO migrations(version) VALUES (2)').run();
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  return db;
}
