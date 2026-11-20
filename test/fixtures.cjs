const { createApp } = require('../app');

function createFixture() {
  const state = {
    dishes: [{ id: 1, name: 'Phở Bò Hà Nội', price: 55000, category: 'Món nước', description: 'Nước dùng đậm đà', imageUrl: null, chefId: 1, available: true, ingredientIds: [1] }],
    chefs: [{ id: 1, name: 'Nguyễn Văn Bếp', specialty: 'Phở & Bún' }],
    ingredients: [{ id: 1, name: 'Thịt bò', unit: 'kg' }],
    profiles: [
      { id: 'manager-id', username: 'manager', email: 'manager@example.com', role: 'manager', isLocked: false, failedLoginAttempts: 0 },
      { id: 'user-id', username: 'customer', email: 'user@example.com', role: 'user', isLocked: false, failedLoginAttempts: 0 }
    ], emails: [], signedOut: [], changedPasswords: [], password: 'correct-password'
  };
  function expand(row, include) {
    if (!row) return null;
    const value = { ...row };
    if (include?.chef) value.chef = state.chefs.find(item => item.id === row.chefId) || null;
    if (include?.ingredients) value.ingredients = state.ingredients.filter(item => row.ingredientIds.includes(item.id));
    return value;
  }
  function model(resource) {
    let sequence = 2;
    return {
      async findMany({ where, include } = {}) {
        return state[resource].filter(item => !where?.name?.contains || item.name.toLocaleLowerCase().includes(where.name.contains.toLocaleLowerCase())).map(item => expand(item, include));
      },
      async findUnique({ where, include }) { return expand(state[resource].find(item => item.id === where.id), include); },
      async create({ data }) {
        const row = { id: sequence++, ...data };
        if (resource === 'dishes') {
          row.chefId = data.chef?.connect?.id || null;
          row.ingredientIds = (data.ingredients?.connect || []).map(item => item.id);
          delete row.chef; delete row.ingredients;
        }
        state[resource].push(row);
        return { ...row };
      },
      async update({ where, data }) {
        const row = state[resource].find(item => item.id === where.id);
        Object.assign(row, data);
        if (resource === 'dishes') {
          row.chefId = data.chef?.connect?.id || null;
          row.ingredientIds = (data.ingredients?.set || []).map(item => item.id);
          delete row.chef; delete row.ingredients;
        }
        return { ...row };
      },
      async delete({ where }) {
        state[resource] = state[resource].filter(item => item.id !== where.id);
        if (resource === 'chefs') state.dishes.forEach(item => { if (item.chefId === where.id) item.chefId = null; });
        if (resource === 'ingredients') state.dishes.forEach(item => { item.ingredientIds = item.ingredientIds.filter(value => value !== where.id); });
        return { id: where.id };
      }
    };
  }
  function matches(profile, where) {
    return Object.entries(where).every(([key, value]) => key === 'unlockTokenExpires'
      ? new Date(profile.unlockTokenExpires) > value.gt : profile[key] === value);
  }
  const db = {
    dish: model('dishes'), chef: model('chefs'), ingredient: model('ingredients'),
    profile: {
      async findFirst({ where }) {
        return state.profiles.find(profile => where.OR ? where.OR.some(condition => matches(profile, condition)) : matches(profile, where)) || null;
      },
      async create({ data }) {
        const row = { failedLoginAttempts: 0, isLocked: false, ...data };
        state.profiles.push(row); return row;
      },
      async update({ where, data }) {
        const row = state.profiles.find(item => item.id === where.id);
        Object.assign(row, data); return row;
      }
    }
  };
  const tokens = new Map();
  function issue(profile) {
    const prefix = profile.id === 'manager-id' ? 'manager' : profile.id === 'user-id' ? 'user' : profile.id;
    const user = { id: profile.id, email: profile.email, user_metadata: { username: profile.username } };
    tokens.set(`${prefix}-token`, user);
    return { user, session: { access_token: `${prefix}-token`, refresh_token: `${prefix}-refresh`, expires_at: Math.floor(Date.now() / 1000) + 3600 } };
  }
  state.profiles.forEach(issue);
  const auth = {
    async getUser(token) { return tokens.has(token) ? { data: { user: tokens.get(token) } } : { error: { status: 401 } }; },
    async signIn({ email, password }) {
      const profile = state.profiles.find(item => item.email === email);
      return profile && password === state.password ? { data: issue(profile) } : { error: { status: 400, code: 'invalid_credentials', message: 'Invalid credentials' } };
    },
    async signUp({ email, options }) { return { data: { user: { id: `registered-${state.profiles.length}`, email, user_metadata: options.data, identities: [{}] }, session: null } }; },
    async refresh(token) {
      const prefix = token.replace(/-refresh$/, '');
      const user = tokens.get(`${prefix}-token`);
      return user ? { data: issue(state.profiles.find(item => item.id === user.id)) } : { error: { status: 401 } };
    },
    async signOut(token) { state.signedOut.push(token); return {}; },
    async resetEmail(email, redirectTo) { state.emails.push({ email, redirectTo }); return {}; },
    async updatePassword(userId, password) { state.changedPasswords.push({ userId, password }); return {}; },
    async deleteUser() { return {}; }
  };
  const config = { managerEmail: 'manager@example.com', appUrl: 'http://localhost:3001' };
  const app = createApp({ db, auth, config, sendUnlockEmail: async (email, link) => state.emails.push({ email, link }) });
  return { app, state, db, auth, config };
}
module.exports = { createFixture };
