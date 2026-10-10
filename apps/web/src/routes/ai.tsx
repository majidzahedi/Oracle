import { useChat } from "@ai-sdk/react";
import { Bubble, BubbleContent } from "@oracle/ui/components/bubble";
import { Button } from "@oracle/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@oracle/ui/components/empty";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@oracle/ui/components/input-group";
import {
	Message,
	MessageContent as MessageBody,
	MessageHeader,
} from "@oracle/ui/components/message";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@oracle/ui/components/message-scroller";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@oracle/ui/components/tooltip";
import { createFileRoute } from "@tanstack/react-router";
import { DefaultChatTransport } from "ai";
import {
	ArrowUpIcon,
	Loader2,
	MessageCircleDashedIcon,
	RotateCwIcon,
} from "lucide-react";
import { type FormEvent, type KeyboardEvent, useState } from "react";
import { Streamdown } from "streamdown";

import { ENV } from "../env";

export const Route = createFileRoute("/ai")({
	component: RouteComponent,
});

function RouteComponent() {
	const [input, setInput] = useState("");
	const { messages, sendMessage, status, setMessages } = useChat({
		transport: new DefaultChatTransport({
			api: `${ENV.VITE_SERVER_URL}/ai`,
		}),
	});
	const isSending = status === "submitted" || status === "streaming";

	const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const text = input.trim();
		if (!text || isSending) return;
		sendMessage({ text });
		setInput("");
	};

	const handlePromptKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			e.currentTarget.form?.requestSubmit();
		}
	};

	const resetConversation = () => {
		setInput("");
		setMessages([]);
	};

	return (
		<MessageScrollerProvider>
			<div className="flex h-full min-h-0 w-full flex-col">
				<header className="shrink-0 border-b px-4 py-3">
					<div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
						<div className="min-w-0">
							<h1 className="font-medium text-sm">New Chat</h1>
							<p className="text-muted-foreground text-xs/relaxed">
								How can I help you today?
							</p>
						</div>
						<div className="shrink-0">
							<Tooltip>
								<TooltipTrigger
									render={
										<Button
											type="button"
											variant="outline"
											size="icon-sm"
											aria-label="Reset conversation"
											onClick={resetConversation}
											disabled={isSending}
										/>
									}
								>
									<RotateCwIcon />
								</TooltipTrigger>
								<TooltipContent>Reset</TooltipContent>
							</Tooltip>
						</div>
					</div>
				</header>
				<main className="min-h-0 flex-1">
					{messages.length === 0 && !isSending ? (
						<Empty className="mx-auto h-full max-w-3xl px-4">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<MessageCircleDashedIcon />
								</EmptyMedia>
								<EmptyTitle>Morning, oracle!</EmptyTitle>
								<EmptyDescription>
									What are we working on today?
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<MessageScroller>
							<MessageScrollerViewport>
								<MessageScrollerContent
									aria-busy={isSending}
									className="mx-auto w-full max-w-3xl px-4 py-6"
								>
									{messages.map((message) => {
										const isUser = message.role === "user";

										return (
											<MessageScrollerItem
												key={message.id}
												scrollAnchor={isUser}
											>
												<Message align={isUser ? "end" : "start"}>
													<MessageBody>
														<MessageHeader>
															{isUser ? "You" : "AI Assistant"}
														</MessageHeader>
														<Bubble
															align={isUser ? "end" : "start"}
															variant={isUser ? "default" : "secondary"}
														>
															<BubbleContent>
																{message.parts?.map((part, index) => {
																	if (part.type === "text") {
																		return (
																			<Streamdown
																				key={index}
																				isAnimating={
																					status === "streaming" &&
																					message.role === "assistant"
																				}
																			>
																				{part.text}
																			</Streamdown>
																		);
																	}
																	return null;
																})}
															</BubbleContent>
														</Bubble>
													</MessageBody>
												</Message>
											</MessageScrollerItem>
										);
									})}
									{status === "submitted" && (
										<MessageScrollerItem>
											<Message align="start">
												<MessageBody>
													<Bubble variant="secondary">
														<BubbleContent className="flex items-center gap-2">
															<Loader2 className="size-3.5 animate-spin" />
															<span className="shimmer">Thinking...</span>
														</BubbleContent>
													</Bubble>
												</MessageBody>
											</Message>
										</MessageScrollerItem>
									)}
									<MessageScrollerItem scrollAnchor />
								</MessageScrollerContent>
							</MessageScrollerViewport>
							<MessageScrollerButton />
						</MessageScroller>
					)}
				</main>
				<footer className="shrink-0 border-t px-4 py-3">
					<div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
						<form onSubmit={handleSubmit} className="w-full">
							<InputGroup>
								<InputGroupTextarea
									name="prompt"
									value={input}
									onChange={(e) => setInput(e.target.value)}
									onKeyDown={handlePromptKeyDown}
									placeholder="Type your message..."
									className="max-h-32 min-h-14"
									rows={1}
									autoComplete="off"
									autoFocus
									disabled={isSending}
								/>
								<InputGroupAddon align="block-end" className="pt-1">
									<InputGroupButton
										type="submit"
										variant="default"
										size="icon-sm"
										disabled={isSending || !input.trim()}
										className="ml-auto"
									>
										{isSending ? (
											<Loader2 className="animate-spin" />
										) : (
											<ArrowUpIcon />
										)}
										<span className="sr-only">Send</span>
									</InputGroupButton>
								</InputGroupAddon>
							</InputGroup>
						</form>
					</div>
				</footer>
			</div>
		</MessageScrollerProvider>
	);
}
