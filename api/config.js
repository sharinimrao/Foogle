export default function handler(req, res) {
  res.status(200).json({
    pusherKey: process.env.PUSHER_KEY || null,
    pusherCluster: process.env.PUSHER_CLUSTER || null,
  });
}
