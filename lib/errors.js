class HttpError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function id(value) {
  const number = typeof value === 'number' ? value : /^\d+$/.test(value || '') ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
function validate(errors) {
  if (errors.length) throw new HttpError(400, 'Vui lòng kiểm tra dữ liệu.', errors);
}
function found(item) {
  if (!item) throw new HttpError(404, 'Không tìm thấy dữ liệu.');
  return item;
}

module.exports = { HttpError, text, id, validate, found };
