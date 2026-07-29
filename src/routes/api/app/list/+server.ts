// GET /api/app/list — list the .app files in the local dir → [{id, title}].
import { json, type RequestHandler } from '@sveltejs/kit';
import { listApps } from '$lib/server/app-paths';

export const GET: RequestHandler = async () => json(await listApps());
