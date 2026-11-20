import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.js';
import { createDemoData } from '@bep-nha/shared';

// Separate local database: never copies, seeds or writes to Supabase.
export function openDemoDatabase(path = fileURLToPath(new URL('../data/demo.sqlite', import.meta.url))) {
  const db = openDatabase(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS demo_dish_chefs (
      dish_id INTEGER PRIMARY KEY REFERENCES dishes(id) ON DELETE CASCADE,
      chef_id INTEGER REFERENCES chefs(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS demo_dish_ingredients (
      dish_id INTEGER REFERENCES dishes(id) ON DELETE CASCADE,
      ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE CASCADE,
      PRIMARY KEY (dish_id, ingredient_id)
    );
  `);
  if (!db.prepare('SELECT version FROM migrations WHERE version = 100').get()) {
    db.exec('BEGIN');
    try {
      const chefLink = db.prepare('INSERT INTO demo_dish_chefs(dish_id, chef_id) VALUES (?, ?)');
      const ingredientLink = db.prepare('INSERT INTO demo_dish_ingredients(dish_id, ingredient_id) VALUES (?, ?)');
      // Explicit sample relationships; these are not the user's Supabase data.
      for (const [dishId, chefId, ingredientIds] of [
        [1, 1, [1, 2, 5, 6]], [2, 2, [3, 5, 6]], [3, 1, [5, 6]],
        [4, 1, [5, 6]], [5, 3, [4]], [6, 2, [3, 5, 6]],
      ]) {
        chefLink.run(dishId, chefId);
        ingredientIds.forEach(ingredientId => ingredientLink.run(dishId, ingredientId));
      }
      db.prepare('INSERT INTO migrations(version) VALUES (100)').run();
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  // Add a larger explicitly labeled sample set once; never restore user-deleted rows.
  if (!db.prepare('SELECT version FROM migrations WHERE version = 101').get()) {
    db.exec('BEGIN');
    try {
      const dish = db.prepare('INSERT INTO dishes(name,description,price,category,available) VALUES (?,?,?,?,?)');
      const chef = db.prepare('INSERT INTO demo_dish_chefs(dish_id,chef_id) VALUES (?,?)');
      const ingredient = db.prepare('INSERT INTO demo_dish_ingredients(dish_id,ingredient_id) VALUES (?,?)');
      for (const sample of createDemoData().dishes) {
        const result=dish.run(sample.name,sample.description,sample.price,sample.category,Number(sample.available));
        const id=Number(result.lastInsertRowid);
        if(sample.chefId && db.prepare('SELECT id FROM chefs WHERE id=?').get(sample.chefId)) chef.run(id,sample.chefId);
        for(const item of sample.ingredients) if(db.prepare('SELECT id FROM ingredients WHERE id=?').get(item.id)) ingredient.run(id,item.id);
      }
      db.prepare('INSERT INTO migrations(version) VALUES(101)').run();db.exec('COMMIT');
    } catch(error){db.exec('ROLLBACK');db.close();throw error;}
  }
  return db;
}
