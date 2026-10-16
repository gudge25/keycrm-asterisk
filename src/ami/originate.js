function buildOriginateAction({ actionId, caller, destinationNumber, channelTemplate, context, timeoutMs }) {
  return {
    action: 'originate',
    actionid: actionId,
    channel: channelTemplate.replace('{ext}', caller),
    context,
    exten: destinationNumber,
    priority: 1,
    callerid: `"${destinationNumber}" <${destinationNumber}>`,
    timeout: timeoutMs,
    async: 'true',
  };
}

function buildHangupAction({ channel, cause }) {
  return {
    action: 'hangup',
    channel,
    cause: cause ?? 16,
  };
}

module.exports = { buildOriginateAction, buildHangupAction };
