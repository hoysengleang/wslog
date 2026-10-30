import { useEffect, useState } from 'react';

/**
 * Two-step confirm for destructive buttons, without a modal: the first click
 * arms the button, a second click within `ms` runs `action`.
 */
export function useConfirm(action: () => void, ms = 3000): { armed: boolean; onClick(): void } {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ms);
    return () => clearTimeout(timer);
  }, [armed, ms]);

  return {
    armed,
    onClick() {
      if (!armed) return setArmed(true);
      setArmed(false);
      action();
    },
  };
}
