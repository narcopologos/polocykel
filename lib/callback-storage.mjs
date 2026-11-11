function documentUrl(project, requestId) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/polo_callbacks/${requestId}`;
}

async function firestoreRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const error = new Error(`Firestore: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function saveRequest({ project, token, requestId, phone, name = '', testTime }) {
  const url = documentUrl(project, requestId);
  const fields = {
    phone: { stringValue: phone },
    name: { stringValue: name },
    testTime: { stringValue: testTime },
    createdAt: { timestampValue: new Date().toISOString() },
    calendarCreated: { booleanValue: false }
  };
  try {
    return await firestoreRequest(`${url}?currentDocument.exists=false`, token, {
      method: 'PATCH', body: JSON.stringify({ fields })
    });
  } catch (writeError) {
    let existing;
    try {
      existing = await firestoreRequest(url, token);
    } catch (readError) {
      console.error('Kunde inte verifiera sparad återuppringning:', readError.status || readError.name);
      throw writeError;
    }
    if (existing.fields?.phone?.stringValue !== phone ||
        (existing.fields?.name?.stringValue || '') !== name ||
        existing.fields?.testTime?.stringValue !== testTime) {
      throw new Error('Förfrågans identifierare används redan.');
    }
    return existing;
  }
}

export async function markCalendarCreated({ project, token, requestId }) {
  const url = `${documentUrl(project, requestId)}?updateMask.fieldPaths=calendarCreated&currentDocument.exists=true`;
  await firestoreRequest(url, token, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { calendarCreated: { booleanValue: true } } })
  });
}

export async function logCalendarFailure({ project, token, requestId }) {
  const response = await fetch('https://logging.googleapis.com/v2/entries:write', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      logName: `projects/${project}/logs/polo-calendar`,
      resource: { type: 'global' },
      entries: [{
        severity: 'ERROR',
        jsonPayload: { event: 'calendar_callback_failed', requestId }
      }]
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Cloud Logging: ${response.status}`);
}
