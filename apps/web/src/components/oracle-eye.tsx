import { cn } from "@oracle/ui/lib/utils";

/** The Oracle's emblem: an almond eye with an amber iris, always watching. */
export function OracleEye({
	className,
	watching = true,
}: {
	className?: string;
	watching?: boolean;
}) {
	return (
		<svg
			viewBox="0 0 64 40"
			className={cn("text-primary", watching && "eye-pulse", className)}
			aria-hidden="true"
			focusable="false"
		>
			<defs>
				<radialGradient id="oracle-iris" cx="50%" cy="45%" r="55%">
					<stop offset="0%" stopColor="currentColor" stopOpacity="1" />
					<stop offset="60%" stopColor="currentColor" stopOpacity="0.75" />
					<stop offset="100%" stopColor="currentColor" stopOpacity="0.15" />
				</radialGradient>
			</defs>
			<path
				d="M2 20 C 14 3, 50 3, 62 20 C 50 37, 14 37, 2 20 Z"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.2"
				strokeLinejoin="round"
			/>
			<circle cx="32" cy="20" r="11" fill="url(#oracle-iris)" />
			<ellipse cx="32" cy="20" rx="2.6" ry="7" className="fill-background" />
			<circle cx="36" cy="16" r="1.6" fill="white" opacity="0.7" />
			<path
				d="M32 1 V5 M14 6 L16.5 9 M50 6 L47.5 9"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				opacity="0.6"
			/>
		</svg>
	);
}
