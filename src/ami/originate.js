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

function buildRedirectAction({ channel, context, exten, priority }) {
  return { action: 'redirect', channel, context, exten, priority: priority ?? 1 };
}

function buildExtensionStateAction({ exten, context }) {
  return { action: 'extensionstate', exten, context };
}

module.exports = { buildOriginateAction, buildHangupAction, buildRedirectAction, buildExtensionStateAction };
