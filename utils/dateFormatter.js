import moment from 'moment-timezone';

export const formatToWIB = (date) => {
  return moment(date).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
};

export const formatToWIBDate = (date) => {
  return moment(date).tz('Asia/Jakarta').format('DD/MM/YYYY');
};

export const formatToWIBTime = (date) => {
  return moment(date).tz('Asia/Jakarta').format('HH:mm:ss');
};