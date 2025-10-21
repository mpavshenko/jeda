function getDateRangeFromYesterday(days) {
  const toDate = new Date();
  toDate.setHours(23, 59, 59, 999);
  toDate.setDate(toDate.getDate() - 1); // Yesterday

  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - days + 1);
  fromDate.setHours(0, 0, 0, 0);

  return { fromDate, toDate };
}

function formatDate(date) {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const day = date.getDate().toString().padStart(2, '0');
  const month = months[date.getMonth()];
  return `${month}-${day}`;
}

module.exports = {
  getDateRangeFromYesterday,
  formatDate
};
