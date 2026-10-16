function normalizePhone(raw) {
  if (raw === undefined || raw === null) return '';
  let digits = String(raw).trim().replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  return digits;
}

module.exports = { normalizePhone };
