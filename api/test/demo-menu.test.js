import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoMenuValues } from '../scripts/demo-menu-values.js';

test('demo menu classifies dish styles before ingredients and generates stable VND prices', () => {
  for (const [name, category] of [['Chicken salad', 'Salad'], ['Salmon pasta', 'Mì & pasta'], ['Apple pie', 'Tráng miệng'], ['Beef stew', 'Canh & súp'], ['Shrimp tacos', 'Hải sản'], ['Roasted chicken', 'Gà & gia cầm'], ['Chocolate milkshake', 'Đồ uống']]) {
    const row = { sourceId: name, name, recipeIngredients: ['salt'] };
    const result = demoMenuValues(row);
    assert.equal(result.category, category);
    assert.equal(result.price % 5000, 0);
    assert.ok(result.price >= 15000 && result.price <= 225000);
    assert.deepEqual(result, demoMenuValues(row));
  }
});
