// Mounts the REAL widget with a real React + real socket.io-client (NOT a fake),
// so it talks to the real gateway. Bundled by run.mjs.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { renderActivity } from '../../../src/web/widget.src.js';

const api = { listSessions: async () => [{ id: 'e2e' }] };
const el = document.getElementById('app')!;
createRoot(el).render(renderActivity({ React, api }) as any);
