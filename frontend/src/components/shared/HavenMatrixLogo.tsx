import { useId } from 'react';

interface Props {
  size?: number;
  className?: string;
}

export function HavenMatrixLogo({ size = 36, className = '' }: Props) {
  const uid = useId().replace(/:/g, '');
  const bgId    = `${uid}bg`;
  const centerId = `${uid}ctr`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Haven Matrix"
    >
      <defs>
        <linearGradient id={bgId} x1="4" y1="2" x2="36" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#0C3549" />
          <stop offset="100%" stopColor="#1A7A9A" />
        </linearGradient>
        <radialGradient id={centerId} cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#72C8E2" />
        </radialGradient>
      </defs>

      {/* Hexagonal badge — pointy-top, references GPU matrix / compute grid */}
      <polygon
        points="20,1.5 35.6,10.75 35.6,29.25 20,38.5 4.4,29.25 4.4,10.75"
        fill={`url(#${bgId})`}
        stroke="rgba(56,174,210,0.65)"
        strokeWidth="0.75"
      />

      {/* Inner concentric hex ring — subtle grid depth */}
      <polygon
        points="20,5.5 31.5,12.25 31.5,27.75 20,34.5 8.5,27.75 8.5,12.25"
        fill="none"
        stroke="rgba(56,174,210,0.15)"
        strokeWidth="0.5"
      />

      {/* H letterform — circuit-board style */}
      <line x1="12" y1="11" x2="12" y2="29" stroke="#38AED2" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="28" y1="11" x2="28" y2="29" stroke="#38AED2" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="12" y1="20" x2="28" y2="20" stroke="#72C8E2" strokeWidth="1.75" strokeLinecap="round" />

      {/* Matrix column ticks between the uprights — references KNN / data grid */}
      <line x1="16" y1="11" x2="16" y2="14" stroke="rgba(114,200,226,0.35)" strokeWidth="1" strokeLinecap="round" />
      <line x1="20" y1="11" x2="20" y2="14" stroke="rgba(114,200,226,0.35)" strokeWidth="1" strokeLinecap="round" />
      <line x1="24" y1="11" x2="24" y2="14" stroke="rgba(114,200,226,0.35)" strokeWidth="1" strokeLinecap="round" />

      {/* Top corner nodes — NVIDIA green, references Spark Hack sponsorship */}
      <circle cx="12" cy="11" r="2.5" fill="#76B900" />
      <circle cx="28" cy="11" r="2.5" fill="#76B900" />

      {/* Bottom corner nodes — teal, service location endpoints */}
      <circle cx="12" cy="29" r="2" fill="#38AED2" />
      <circle cx="28" cy="29" r="2" fill="#38AED2" />

      {/* Central routing-origin node — the person being helped */}
      <circle cx="20" cy="20" r="3.5" fill={`url(#${centerId})`} />
      <circle cx="20" cy="20" r="1.5" fill="#76B900" />
    </svg>
  );
}
