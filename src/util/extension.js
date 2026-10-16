function isValidExtension(value, length) {
  if (typeof value !== 'string') return false;
  const re = new RegExp(`^\\d{${length}}$`);
  return re.test(value);
}

// Pulls a bare extension number out of an Asterisk channel/dialstring
// such as "PJSIP/1002-00000005" or "PJSIP/1002", returning null if the
// remaining identifier isn't exactly `length` digits (e.g. a trunk name).
function extractExtension(channelOrDialstring, length) {
  if (!channelOrDialstring) return null;
  const afterSlash = String(channelOrDialstring).split('/').pop() || '';
  const withoutSuffix = afterSlash.replace(/-[0-9a-fA-F]+$/, '');
  return isValidExtension(withoutSuffix, length) ? withoutSuffix : null;
}

module.exports = { isValidExtension, extractExtension };
