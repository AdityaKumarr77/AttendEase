import { randomUUID } from 'crypto';

const FOLDER_NAME = 'AttendEase Submissions';

export const getDriveConfig = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || '';
  return {
    clientId,
    clientSecret,
    refreshToken,
    isConfigured: Boolean(clientId && clientSecret && refreshToken)
  };
};

let cachedAccessToken: { token: string; expiresAt: number } | null = null;
let cachedFolderId: string | null = null;

export const resetDriveCache = () => {
  cachedAccessToken = null;
  cachedFolderId = null;
};

export async function getAccessToken(): Promise<string> {
  const config = getDriveConfig();
  if (!config.isConfigured) {
    throw new Error('Google Drive credentials are not fully configured');
  }

  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt - 60000) {
    return cachedAccessToken.token;
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token'
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to refresh Google OAuth token (${res.status}): ${errorText}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000
  };
  return cachedAccessToken.token;
}

export async function getOrCreateSubmissionsFolder(): Promise<string> {
  if (cachedFolderId) return cachedFolderId;
  const token = await getAccessToken();

  // Search for existing non-trashed folder
  const query = `name = '${FOLDER_NAME.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (searchRes.ok) {
    const searchData = (await searchRes.json()) as { files?: { id: string; name: string }[] };
    if (searchData.files && searchData.files.length > 0) {
      cachedFolderId = searchData.files[0].id;
      return cachedFolderId;
    }
  }

  // Create folder
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder'
    })
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    throw new Error(`Failed to create Google Drive folder "${FOLDER_NAME}" (${createRes.status}): ${errorText}`);
  }

  const createData = (await createRes.json()) as { id: string };
  cachedFolderId = createData.id;
  return cachedFolderId;
}

export async function uploadToDrive(
  buffer: Buffer,
  originalName: string,
  mimeType?: string
): Promise<{ id: string; name: string }> {
  const token = await getAccessToken();
  const folderId = await getOrCreateSubmissionsFolder();

  const boundary = '===============AttendEaseDriveBoundary' + randomUUID().replace(/-/g, '') + '==';
  const metadata = JSON.stringify({
    name: originalName,
    parents: [folderId]
  });

  const contentType = mimeType || 'application/octet-stream';
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    'utf8'
  );
  const post = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const body = Buffer.concat([pre, buffer, post]);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length)
    },
    body
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google Drive upload failed (${res.status}): ${errorText}`);
  }

  const data = (await res.json()) as { id: string; name: string };
  return { id: data.id, name: data.name };
}

export async function downloadFromDrive(
  fileId: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google Drive file download failed (${res.status}): ${errorText}`);
  }

  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const arrayBuffer = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType
  };
}

export async function deleteFromDrive(fileId: string): Promise<void> {
  try {
    const token = await getAccessToken();
    await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (err) {
    console.error('Failed to delete file from Google Drive:', err);
  }
}
