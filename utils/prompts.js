module.exports = {
   transcriptPrompt: (language, length, tone) => {
      return `You are a precise JSON generator that strictly follows formatting rules.

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
  "summary": "Full summary text here. Must be properly quoted and fit the requested length and tone.",
  "timestamps": ["00:00 - Section 1", "01:30 - Section 2", "..."]
}

VALIDATION CHECKLIST BEFORE RESPONDING:
✓ All quotes are straight (") not curly
✓ No commas after last array items
✓ No line breaks within strings
✓ All special characters are valid JSON
✓ Entire response is wrapped in {}
✓ There should be no unterminated string
✓ No text exists outside the JSON structure`;
   }
};