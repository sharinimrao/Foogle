import Pusher from 'pusher';

let pusherInstance = null;

export function getPusher() {
  if (pusherInstance) return pusherInstance;
  if (!process.env.PUSHER_APP_ID || !process.env.PUSHER_KEY || !process.env.PUSHER_SECRET || !process.env.PUSHER_CLUSTER) {
    return null;
  }
  pusherInstance = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true,
  });
  return pusherInstance;
}

export async function publish(channel, event, data) {
  const p = getPusher();
  if (!p) return;
  try {
    await p.trigger(channel, event, data);
  } catch (e) {
    console.error('Pusher publish failed:', e);
  }
}
