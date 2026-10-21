let mockCalls: { table: string; op: string; args: any[] }[] = [];
jest.mock('@/lib/supabase', () => {
  const chain = (table: string, op: string): any => {
    mockCalls.push({ table, op, args: [] });
    const c: any = new Proxy(() => {}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: any) => Promise.resolve({ data: null, error: null }).then(res);
        return (...args: any[]) => {
          mockCalls.push({ table, op: prop, args });
          return c;
        };
      },
    });
    return c;
  };
  return {
    supabase: {
      from: (table: string) => ({ update: () => chain(table, 'update'), delete: () => chain(table, 'delete') }),
    },
  };
});
jest.mock('@/lib/auth', () => ({ currentUserId: () => 'u' }));

import { removeMember, removeService } from '@/lib/shop';

beforeEach(() => { mockCalls = []; });

describe('leftover barber to service rows', () => {
  it('removing a barber deletes their ab_service_members rows', async () => {
    await removeMember('m1');
    expect(mockCalls.some((c) => c.table === 'ab_service_members' && c.op === 'delete')).toBe(true);
    expect(mockCalls.some((c) => c.table === 'ab_service_members' && c.op === 'eq' && c.args[0] === 'member_id' && c.args[1] === 'm1')).toBe(true);
  });
  it('removing a service deletes its rows', async () => {
    await removeService('s1');
    expect(mockCalls.some((c) => c.table === 'ab_service_members' && c.op === 'eq' && c.args[0] === 'service_id' && c.args[1] === 's1')).toBe(true);
  });
});
