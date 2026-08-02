import { createApp } from '../server/app.js';

const appPromise = createApp();

export default async function handler(req, res) {
  const app = await appPromise;
  return app(req, res);
}
