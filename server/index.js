import { createApp } from './app.js';

const PORT = process.env.PORT || 3001;

createApp({ serveStatic: true })
  .then(app => app.listen(PORT, () => console.log(`Supabase API server: http://localhost:${PORT}`)))
  .catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
