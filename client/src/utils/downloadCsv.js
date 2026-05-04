import api from '../services/api';

function filenameFromDisposition(disposition) {
  if (!disposition) return null;
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match?.[1]?.trim() || null;
}

export async function downloadCsv(path, { params, filename } = {}) {
  const res = await api.get(path, {
    params,
    responseType: 'blob',
    headers: { Accept: 'text/csv' },
  });

  const disposition = res.headers?.['content-disposition'];
  const contentType = res.headers?.['content-type'] || 'text/csv; charset=utf-8';
  const suggested = filenameFromDisposition(disposition);
  const finalName = (suggested || filename || 'export.csv').endsWith('.csv')
    ? (suggested || filename || 'export.csv')
    : `${suggested || filename || 'export'}.csv`;

  const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = finalName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

