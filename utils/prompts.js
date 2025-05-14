module.exports = {
   transcriptPrompt: (language, length, tone) => {
      return `You are a JSON-generating API. Your sole task is to return pure, valid JSON according to the rules below.
    
    INPUT: YouTube captions in SRT format
    
    TASKS:
    1. Clean the transcript:
       - Remove ALL timestamps (e.g. "00:00:00,000 --> 00:00:02,000")
       - Remove non-verbal cues (e.g. [music], [laughter])
       - Join broken lines into complete sentences
    
    2. Extract 4-8 key points:
       - Each must be a single concise sentence
       - Start each with ONE relevant emoji (choose from: ✈️💺🖥️🛩️🍴⌛💼👩‍✈️👨‍✈️🪂🥇🛏️☕😀🚀🔥)
       - Must directly reflect content from transcript
    
    3. Write a ${length} summary:
       - Language: ${language}
       - Tone: ${tone}
       - Word counts: short≈100, medium≈200, long≈400
       - Capture main ideas and tone accurately
    
    4. Create timestamp breakdown:
       - Format: "MM:SS - Description"
       - Include 3-5 most important sections
       - Must match actual video content
    
    IMPORTANT:
    - Return ONLY a pure, parseable JSON object.
    - Do NOT add any commentary or preamble.
    - Do NOT wrap in code blocks.
    - Do NOT use markdown.
    - Do NOT include line breaks **inside** strings.
    
    CRITICAL OUTPUT RULES:
    ✓ Use only straight quotes (")
    ✓ Escape ALL double quotes inside strings as \"
    ✓ No trailing commas
    ✓ Entire output must be valid for JSON.parse()
    ✓ Response must begin with { and end with }
    ✓ No explanation, no formatting, no extra text — just the JSON
    
    OUTPUT TEMPLATE:
    {
      "keypoints": ["emoji Key point 1", "emoji Key point 2", "..."],
      "summary": "Full summary text here. Must be properly quoted and fit the requested length and tone.",
      "timestamps": ["00:00 - Section 1", "01:30 - Section 2", "..."]
    }`
   },
   combineSummariesPrompt: (language, length, tone) => {
      return `You are a precise JSON generator that strictly follows formatting rules.

INPUT: A JSON object containing multiple partial summaries, their keypoints, and timestamps from a video's captions, split into parts.
TASKS:
1. Combine the partial summaries into a single cohesive summary:
   - Write a ${length} summary.
   - Language: ${language}
   - Tone: ${tone}
   - Word counts: short≈100, medium≈200, long≈400
   - Ensure the summary is coherent, avoids redundancy, and captures the main ideas across all parts
   - Do not simply concatenate summaries; rewrite them into a unified narrative that reflects the entire video

2. Synthesize 4-8 key points:
   - Each must be a single concise sentence
   - Start each with ONE relevant emoji (choose from: ✈️💺🖥️🛩️🍴⌛💼👩‍✈️👨‍✈️🪂🥇🛏️☕😀🚀🔥)
   - Select the most important points from the provided keypoints, consolidating duplicates
   - Ensure points reflect the entire video's content, including themes from all parts

3. Create a timestamp breakdown:
   - Format: "00:00 - Description" according to the timestamps provided
   - Ensure timestamps are in the format "MM:SS - Description" or "HH:MM - Description"
   - Include 3-5 most important sections that span the entire duration of the video
   - Prioritize timestamps to represent key moments from the beginning, middle, and end of the video, ensuring coverage of later sections
   - Consolidate and rephrase timestamps from the input to avoid redundancy and ensure relevance
   - Ensure at least one timestamp is close to the video's end to reflect its full scope

INPUT FORMAT:
{
  "summaries": "Part 1: Summary text...\n\nPart 2: Summary text...",
  "keypoints": ["emoji Key point 1", "emoji Key point 2", "..."],
  "timestamps": ["00:00 - Section 1", "01:30 - Section 2", "..."]
}

CRITICAL OUTPUT RULES:
1. You MUST output ONLY pure, valid JSON
2. The ENTIRE response must be parseable by JSON.parse()
3. NO markdown, code blocks, or external formatting
4. NO trailing commas
5. ALL strings must be properly quoted
6. NO special character escaping (e.g. use " not \\")
7. Validate your JSON meets these requirements before returning

OUTPUT TEMPLATE (copy this exactly, replace placeholders):
{
  "keypoints": ["emoji Key point 1", "emoji Key point 2", "..."],
  "summary": "Combined summary text here. Must be properly quoted and fit the requested length and tone.",
  "timestamps": ["00:00:00 - Section 1", "01:30:00 - Section 2", "..."]
}

VALIDATION CHECKLIST BEFORE RESPONDING:
✓ All quotes are straight (") not curly
✓ No commas after last array items
✓ No line breaks within strings
✓ All special characters are valid JSON
✓ Entire response is wrapped in {}
✓ There should be no unterminated string
✓ No text exists outside the JSON structure`;
   },
   chatPrompt: (summary, caption, message) => {
      const chatHistory = summary.chats.map((chat) => ({
         role: chat.sender === "user" ? "user" : "assistant",
         content: chat.text,
      }));
      return [
         {
            role: "system",
            content: `You are a helpful AI assistant. Answer the user's question based on the video captions and summary provided. Maintain a conversational tone and use the chat history for context. Use the language in which summary is generated. Add escape sequence "\n" for better paragraphing if the response is long. If caption is not provided use the summary to answer user query.

         ${caption && caption.rawCaptions.length > 0
                  ? `**Video Captions**: ${caption.rawCaptions.substring(0, 65000)}`
                  : ""}
         **Summary**: ${summary.summaryText}
         **Key Points**: ${summary.keypoints.join(", ")}`
         },
         ...chatHistory,
         { role: "user", content: message },
      ];
   }
};