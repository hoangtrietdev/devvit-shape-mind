import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import type {
  DecrementResponse,
  IncrementResponse,
  InitResponse,
  LeaderboardResponse,
  LeaderboardEntry,
  SaveScoreRequest,
  SaveScoreResponse,
} from '../../shared/api';

type ErrorResponse = {
  status: 'error';
  message: string;
};

const LEADERBOARD_KEY = 'shape_memoize_leaderboard';

export const api = new Hono();

api.get('/init', async (c) => {
  const { postId } = context;

  if (!postId) {
    console.error('API Init Error: postId not found in devvit context');
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required but missing from context',
      },
      400
    );
  }

  try {
    const [count, username] = await Promise.all([
      redis.get('count'),
      reddit.getCurrentUsername(),
    ]);

    return c.json<InitResponse>({
      type: 'init',
      postId,
      count: count ? parseInt(count) : 0,
      username: username ?? 'anonymous',
    });
  } catch (error) {
    console.error(`API Init Error for post ${postId}:`, error);
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      400
    );
  }
});

api.post('/increment', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'postId is required' },
      400
    );
  }
  const count = await redis.incrBy('count', 1);
  return c.json<IncrementResponse>({ count, postId, type: 'increment' });
});

api.post('/decrement', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'postId is required' },
      400
    );
  }
  const count = await redis.incrBy('count', -1);
  return c.json<DecrementResponse>({ count, postId, type: 'decrement' });
});

// ─── Leaderboard ────────────────────────────────────────────────────────────

api.get('/leaderboard', async (c) => {
  try {
    const data = await redis.get(LEADERBOARD_KEY);
    const entries: LeaderboardEntry[] = data
      ? (JSON.parse(data) as LeaderboardEntry[])
      : [];
    return c.json<LeaderboardResponse>({ type: 'leaderboard', entries });
  } catch (error) {
    console.error('Leaderboard GET error:', error);
    return c.json<LeaderboardResponse>({ type: 'leaderboard', entries: [] });
  }
});

api.post('/score', async (c) => {
  try {
    const body = await c.req.json<SaveScoreRequest>();
    const { name, score } = body;

    if (!name || typeof score !== 'number') {
      return c.json<ErrorResponse>(
        { status: 'error', message: 'name and score required' },
        400
      );
    }

    const data = await redis.get(LEADERBOARD_KEY);
    const current: LeaderboardEntry[] = data
      ? (JSON.parse(data) as LeaderboardEntry[])
      : [];

    current.push({ name: name.trim().slice(0, 20), score });
    current.sort((a, b) => b.score - a.score);
    const top10 = current.slice(0, 10);

    await redis.set(LEADERBOARD_KEY, JSON.stringify(top10));

    return c.json<SaveScoreResponse>({ type: 'save_score', entries: top10 });
  } catch (error) {
    console.error('Leaderboard POST error:', error);
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});
