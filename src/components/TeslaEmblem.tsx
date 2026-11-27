interface TeslaEmblemProps {
  size?: number;
}

/**
 * Stylized T emblem used solely to identify Tesla-operated NACS chargers.
 */
export function TeslaEmblem({ size = 12 }: TeslaEmblemProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 5.4c3.4 0 6.8.5 9.2 1.6l.8-2.2C19.1 3.7 15.6 3.2 12 3.2S4.9 3.7 2 4.8l.8 2.2C5.2 5.9 8.6 5.4 12 5.4zm0 2.3c-2.6 0-5.1.3-7.4.9l1.2 1.9c1.6-.3 3.2-.5 4.8-.6l1.4 11.4 1.4-11.4c1.6.1 3.2.3 4.8.6l1.2-1.9c-2.3-.6-4.8-.9-7.4-.9z" />
    </svg>
  );
}
