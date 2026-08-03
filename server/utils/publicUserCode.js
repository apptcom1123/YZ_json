import crypto from 'crypto';

const PUBLIC_USER_CODE_NAMESPACE='iching-reader:public-user-code:v1:';

export function publicUserCode(userId){
  if(!userId)return null;
  const digest=crypto.createHash('sha256')
    .update(PUBLIC_USER_CODE_NAMESPACE+String(userId))
    .digest('hex')
    .slice(0,12)
    .toUpperCase();
  return `U-${digest}`;
}
