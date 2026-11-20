import type { DayReport, GameState, ProjectResult } from '../types/game'

// 仅供前端隔离单元测试：静态协议样本，不模拟 C++ 规则，不供生产代码使用。
export function idleState(): GameState {
  return {
    version: 2, seed: 12345, day: 1, funds: 2000000, reputation: 0, phase: 'idle',
    staff: [
      { id: 'staff_01', name: '林导演', role: 'director', skill: 70, morale: 80, assignment: 'pre', overtime: false },
      { id: 'staff_02', name: '陈原画', role: 'key_animator', skill: 75, morale: 80, assignment: 'mid', overtime: false },
      { id: 'staff_03', name: '许动画', role: 'animator', skill: 55, morale: 80, assignment: 'mid', overtime: false },
      { id: 'staff_04', name: '周摄影', role: 'photographer', skill: 65, morale: 80, assignment: 'post', overtime: false },
    ],
    offers: [
      { id: 'proj_ova_01', name: '放学后的第七帧', type: 'ova', budget: 8000000, duration_days: 20, target_quality: 60, min_reputation: 0 },
      { id: 'proj_tv_01', name: '星轨列车', type: 'tv', budget: 14000000, duration_days: 26, target_quality: 68, min_reputation: 0 },
      { id: 'proj_movie_01', name: '未寄出的夏天', type: 'movie', budget: 24000000, duration_days: 30, target_quality: 78, min_reputation: 20 },
    ],
    project: null, pending_event: null, end_reason: null,
  }
}

export function producingState(): GameState {
  return {
    ...idleState(), funds: 10000000, phase: 'producing', offers: [],
    project: {
      id: 'proj_ova_01', name: '放学后的第七帧', type: 'ova', budget: 8000000, spent: 0,
      start_day: 1, deadline_day: 20, target_quality: 60, policy: 'normal',
      stages: {
        pre: { progress: 30, quality: 72, outsourced: false },
        mid: { progress: 20, quality: 65, outsourced: false },
        post: { progress: 10, quality: 68, outsourced: false },
      },
    },
  }
}

export function eventState(): GameState {
  return {
    ...producingState(), phase: 'event_pending', day: 2, seed: 87654,
    pending_event: {
      id: 'evt_fixture', title: '隔离测试制作事件', description: '这是前端单元测试的事件样本。',
      options: [
        { id: 'opt_a', label: '支援方案（核心标签）', effect: { funds: -300000, morale: 8 } },
        { id: 'opt_b', label: '延期方案（核心标签）', effect: { deadline_days: 1, stage_quality: { stage: 'mid', delta: -3 } } },
      ],
    },
  }
}

export function endedState(): GameState {
  return { ...producingState(), day: 21, phase: 'ended', end_reason: 'deadline' }
}

export function dayReport(): DayReport {
  return {
    day: 1, funds_delta: -345678,
    stage_deltas: [
      { stage: 'pre', progress: 7, quality: -2 },
      { stage: 'mid', progress: 5, quality: 3 },
      { stage: 'post', progress: 2, quality: 4 },
    ],
    morale_delta: -3, rework: true, message: '隔离测试：核心返回的制作回执。',
  }
}

export function projectResult(): ProjectResult {
  return { end_reason: 'deadline', quality_score: 67, revenue: 4321987, cost: 5678901, profit: -1356914, reputation_delta: -5, grade: 'B' }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
