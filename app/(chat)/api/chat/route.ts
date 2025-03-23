import { convertToCoreMessages, Message, streamText } from "ai";
import { z } from "zod";

import { geminiProModel } from "@/ai";
import { auth } from "@/app/(auth)/auth";
import { deleteChatById, getChatById, saveChat } from "@/db/queries";
import { generateUUID } from "@/lib/utils";

export async function POST(request: Request) {
  const { id, messages }: { id: string; messages: Array<Message> } = await request.json();
  const session = await auth();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const coreMessages = convertToCoreMessages(messages).filter(
    (message) => message.content.length > 0,
  );

  const result = await streamText({
    model: geminiProModel,
    system: `\n
        - You are a ChatGPT-like AI assistant.
        - Answer questions accurately and provide useful information.
        - Engage in meaningful conversations and assist with coding, learning, or daily tasks.
        - Keep responses concise but informative.
        - Remember previous messages within the same chat session.
        - Today's date is ${new Date().toLocaleDateString()}.
      `,
    messages: coreMessages,
    tools: {
      getGeneralKnowledge: {
        description: "Answer general knowledge questions",
        parameters: z.object({
          question: z.string().describe("The question the user wants to ask"),
        }),
        execute: async ({ question }) => {
          // Simulated response (Replace with actual API if needed)
          return { answer: `Here's some information on: ${question}` };
        },
      },
      getWeather: {
        description: "Get the current weather for a location",
        parameters: z.object({
          city: z.string().describe("City name"),
        }),
        execute: async ({ city }) => {
          const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&current=temperature_2m&timezone=auto`,
          );
          const weatherData = await response.json();
          return { weather: `Current temperature in ${city}: ${weatherData.current.temperature_2m}°C` };
        },
      },
    },
    onFinish: async ({ responseMessages }) => {
      if (session.user && session.user.id) {
        try {
          await saveChat({
            id,
            messages: [...coreMessages, ...responseMessages], // Store conversation history
            userId: session.user.id,
          });
        } catch (error) {
          console.error("Failed to save chat history");
        }
      }
    },
    experimental_telemetry: {
      isEnabled: true,
      functionId: "stream-text",
    },
  });

  return result.toDataStreamResponse({});
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new Response("Not Found", { status: 404 });
  }

  const session = await auth();

  if (!session || !session.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const chat = await getChatById({ id });

    if (chat.userId !== session.user.id) {
      return new Response("Unauthorized", { status: 401 });
    }

    await deleteChatById({ id });

    return new Response("Chat deleted", { status: 200 });
  } catch (error) {
    return new Response("An error occurred while processing your request", {
      status: 500,
    });
  }
}
