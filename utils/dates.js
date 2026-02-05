const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function getDateRangeFromYesterday(days) {
  const toDate = new Date();
  toDate.setHours(23, 59, 59, 999);
  toDate.setDate(toDate.getDate() - 1); // Yesterday

  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - days + 1);
  fromDate.setHours(0, 0, 0, 0);

  return { fromDate, toDate };
}

function getMonStr(date) {
  return MONTHS[date.getMonth()];
}

function formatDate(date) {
  const day = date.getDate().toString().padStart(2, '0');
  const month = getMonStr(date);
  return `${day}${month}`;
}

// Format date to RFC3339 (YYYY-MM-DDTHH:MM:SS)
function formatRFC3339(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

module.exports = {
  getDateRangeFromYesterday,
  getMonStr,
  formatDate,
  formatRFC3339
};
