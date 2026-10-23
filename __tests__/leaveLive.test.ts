jest.mock('expo-router', () => ({
  router: { canGoBack: jest.fn(), back: jest.fn(), canDismiss: jest.fn(() => false), dismissAll: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/lib/siteStore', () => ({ loadSite: jest.fn() }));
import { router } from 'expo-router';
import { leaveLive, markReturnAfterLive, takeReturnAfterLive } from '@/lib/nav';

const mockRouter = router as unknown as Record<string, jest.Mock>;
beforeEach(() => Object.values(mockRouter).forEach((f) => (f as jest.Mock).mockClear()));

describe('live screen Done', () => {
  it('after Update my site it goes back to the setup screen', () => {
    mockRouter.canGoBack.mockReturnValue(true);
    leaveLive(true);
    expect(mockRouter.back).toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
  it('a normal publish lands on Settings', () => {
    mockRouter.canGoBack.mockReturnValue(true);
    leaveLive(false);
    expect(mockRouter.replace).toHaveBeenCalledWith('/settings');
  });
  it('the return flag is read once', () => {
    markReturnAfterLive();
    expect(takeReturnAfterLive()).toBe(true);
    expect(takeReturnAfterLive()).toBe(false);
  });
});
