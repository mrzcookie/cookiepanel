import { ThemeProvider } from "@/components/providers/theme";
import "./globals.css";

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body className="flex min-h-screen flex-col">
				<ThemeProvider>{children}</ThemeProvider>
			</body>
		</html>
	);
}
