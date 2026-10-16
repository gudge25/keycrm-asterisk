function makeCallEndRoute({ callManager }) {
  return async function callEnd(body) {
    const id = body.id ? String(body.id) : undefined;
    const caller = body.caller ? String(body.caller) : undefined;
    const destinationNumber = body.destination_number ? String(body.destination_number) : undefined;

    if (!id && !caller && !destinationNumber) {
      const err = new Error('id, caller, or destination_number is required');
      err.statusCode = 400;
      throw err;
    }

    const result = await callManager.endCall({ id, caller, destinationNumber });
    return { status: 200, body: { status: 'ok', id: result.id } };
  };
}

module.exports = { makeCallEndRoute };
