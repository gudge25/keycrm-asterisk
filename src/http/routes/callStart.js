function makeCallStartRoute({ callManager }) {
  return async function callStart(body) {
    const { id } = await callManager.startOutgoingCall({
      caller: String(body.caller || '').trim(),
      destinationNumber: String(body.destination_number || '').trim(),
    });
    return { status: 200, body: { status: 'accepted', id } };
  };
}

module.exports = { makeCallStartRoute };
