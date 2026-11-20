import { createHash } from 'node:crypto';

// Illustrative VND menu prices, not market estimates or original Kaggle data.
const groups = [
  ['Đồ uống', /\b(cocktail|martini|margarita|smoothie|lemonade|coffee|espresso|spritz|sangria|mojito|milkshake|hot chocolate|iced tea|punch)\b/, 20000, 65000],
  ['Tráng miệng', /\b(cake|cookies?|pie|pudding|tart|ice cream|sorbet|brownies?|muffins?|scones?|waffles?|pancakes?|fudge|toffee|cheesecake|cupcakes?|custard|meringue|dessert|cobbler|crumble|gelato|truffles?)\b/, 25000, 85000],
  ['Sốt & gia vị', /\b(sauce|dressing|marinade|vinaigrette|chutney|relish|salsa|pesto|jam|preserves?|compound butter|seasoning|spice mix|dip|glaze)\b/, 15000, 45000],
  ['Salad', /\b(salads?|slaw|coleslaw)\b/, 35000, 85000],
  ['Canh & súp', /\b(soups?|chowder|bisque|broth|gazpacho|stew|gumbo)\b/, 35000, 95000],
  ['Bánh mì & bánh mặn', /\b(bread|sandwich|burger|pizza|toast|bagel|biscuit|focaccia|flatbread|quesadilla|taco|wrap|quiche)\b/, 25000, 85000],
  ['Mì & pasta', /\b(pasta|noodles?|spaghetti|linguine|fettuccine|lasagna|ravioli|gnocchi|penne|macaroni|ramen|udon|soba)\b/, 45000, 125000],
  ['Cơm & ngũ cốc', /\b(rice|risotto|pilaf|quinoa|couscous|barley|polenta|oatmeal|porridge)\b/, 35000, 95000],
  ['Hải sản', /\b(fish|salmon|tuna|shrimp|prawn|crab|lobster|scallop|mussel|clam|oyster|squid|octopus|halibut|trout|cod|anchov|sardine|seafood)\w*\b/, 75000, 195000],
  ['Thịt bò & cừu', /\b(beef|steak|veal|lamb|mutton|brisket|oxtail)\b/, 85000, 225000],
  ['Thịt heo', /\b(pork|bacon|ham|prosciutto|pancetta|chorizo|sausage|spareribs?)\b/, 55000, 145000],
  ['Gà & gia cầm', /\b(chicken|turkey|duck|goose|quail|poultry)\b/, 45000, 125000],
  ['Món rau củ', /\b(vegetable|potato|tomato|carrot|spinach|broccoli|cauliflower|mushroom|eggplant|zucchini|cabbage|bean|lentil|tofu|asparagus|squash|peas?|beet|corn)\w*\b/, 25000, 85000],
];

export function demoMenuValues(row) {
  const name = row.name.toLowerCase().normalize('NFKD');
  let group = groups.find(([, pattern]) => pattern.test(name));
  // Ingredient fallback only selects a broad protein/vegetable group.
  if (!group) {
    const ingredients = (row.recipeIngredients || []).join(' ').toLowerCase();
    group = groups.slice(8).find(([, pattern]) => pattern.test(ingredients));
  }
  const [category, , minimum, maximum] = group || ['Món tổng hợp', null, 40000, 110000];
  const seed = createHash('sha256').update(`demo-menu-v1:${row.sourceId ?? row.id}`).digest().readUInt32BE(0);
  const price = minimum + (seed % ((maximum - minimum) / 5000 + 1)) * 5000;
  return { category, price };
}
