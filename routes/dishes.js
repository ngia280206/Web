const express = require('express');
const { id, text, found, HttpError } = require('../lib/errors');

module.exports = ({ db }) => {
  const router = express.Router();
  router.get('/', async (req, res) => {
    const q = text(req.query.q);
    const dishes = await db.dish.findMany({
      where: q ? { name: { contains: q } } : {},
      include: { chef: true, ingredients: true }, orderBy: { id: 'asc' }
    });
    res.json({ dishes, q });
  });
  router.get('/:id', async (req, res) => {
    const dishId = id(req.params.id);
    if (!dishId) throw new HttpError(404, 'Mã món ăn không hợp lệ.');
    const dish = found(await db.dish.findUnique({ where: { id: dishId }, include: { chef: true, ingredients: true } }));
    res.json({ dish });
  });
  return router;
};
