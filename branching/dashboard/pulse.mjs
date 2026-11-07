// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: Elastic-2.0
// License: see LICENSE in the repository root.

// Avoid animating hidden pages and honor changes to the motion preference.

export function createPulse() {
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let pulseTimer;
    let hasActiveNodes = false;

    function updatePulse() {
        const active = hasActiveNodes && !document.hidden && !reducedMotion.matches;
        if (!active) {
            clearTimeout(pulseTimer);
            pulseTimer = null;
            document.documentElement.classList.remove('pulse-dim');
            return;
        }
        if (!pulseTimer)
            pulseTimer = setTimeout(() => {
                pulseTimer = null;
                document.documentElement.classList.toggle('pulse-dim');
                updatePulse();
            }, 700);
    }
    reducedMotion.addEventListener('change', updatePulse);
    document.addEventListener('visibilitychange', updatePulse);
    return {
        update(run) {
            hasActiveNodes = Boolean(run?.nodes.some((node) => node.active));
            updatePulse();
        },
        stop() {
            clearTimeout(pulseTimer);
            reducedMotion.removeEventListener('change', updatePulse);
            document.removeEventListener('visibilitychange', updatePulse);
        }
    };
}
