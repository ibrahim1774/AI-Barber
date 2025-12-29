
import { GoogleGenAI, Type } from "@google/genai";

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const inputs = req.body;
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

  if (!apiKey) {
    return res.status(500).json({ message: 'Server configuration error: API Key missing.' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    // 1. Generate Text Content
    const textPromise = ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Generate luxury barbershop website content for "${inputs.shopName}" in "${inputs.area}". 
      Phone: ${inputs.phone}.
      Tone: Premium, high-end, masculine, professional. 
      Hero heading MUST explicitly include both the shop name ("${inputs.shopName}") and the area ("${inputs.area}"). 
      Include: 
      1. A catchy hero heading and tagline.
      2. "About Us" section with 2 detailed paragraphs.
      3. Details for 4 services: Haircuts, Beard Styling, Traditional Shave, and Precision Fade.
      4. A professional email.
      5. A full address in ${inputs.area}.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            hero: {
              type: Type.OBJECT,
              properties: {
                heading: { type: Type.STRING },
                tagline: { type: Type.STRING },
              },
              required: ["heading", "tagline"],
            },
            about: {
              type: Type.OBJECT,
              properties: {
                heading: { type: Type.STRING },
                paragraphs: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["heading", "paragraphs"],
            },
            services: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  subtitle: { type: Type.STRING },
                },
                required: ["title", "description", "subtitle"],
              },
            },
            contact: {
              type: Type.OBJECT,
              properties: {
                email: { type: Type.STRING },
                address: { type: Type.STRING },
              },
              required: ["email", "address"],
            }
          },
          required: ["hero", "about", "services", "contact"],
        }
      }
    });

    // 2. Prepare Image Generation Prompts
    const imagePrompts = [
      `Cinematic hero image of a barber in a luxury shop in ${inputs.area}, moody atmosphere, professional photography, 16:9`,
      `Styled interior of ${inputs.shopName}, leather vintage chairs, marble floors, soft lighting, 4:3`,
      `Close-up of premium gold-plated barber scissors and a silver straight razor, 1:1`,
      `A sharp skin fade haircut at ${inputs.shopName}, clean edges, 1:1`,
      `A barber applying warm lather with a silver brush, luxury ritual, 1:1`,
      `Modern masculine hair styling session at ${inputs.shopName}, dynamic movement, 1:1`,
      `Close-up of barber's hands using a straight razor for precision beard lineup, 1:1`,
      `Sophisticated entrance of ${inputs.shopName} in ${inputs.area}, architectural detail, 1:1`,
    ];

    // Execute text and first few images in parallel to stay within timeout
    const [textResponse, ...imageResponses] = await Promise.all([
      textPromise,
      ...imagePrompts.map(prompt => 
        ai.models.generateContent({
          model: "gemini-2.5-flash-image",
          contents: { parts: [{ text: prompt }] },
          config: { imageConfig: { aspectRatio: "1:1" } }
        }).catch(e => {
          console.error("Image Gen Error:", e);
          return null;
        })
      )
    ]);

    const content = JSON.parse(textResponse.text || '{}');
    
    // Extract image data
    const imageUrls = imageResponses.map(res => {
      if (!res) return "";
      const part = res.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
      return part ? `data:image/png;base64,${part.inlineData.data}` : "";
    });

    const serviceIcons: ('scissors' | 'razor' | 'mustache' | 'face')[] = ['scissors', 'razor', 'mustache', 'face'];

    const finalData = {
      shopName: inputs.shopName,
      area: inputs.area,
      phone: inputs.phone,
      hero: {
        heading: content.hero?.heading || `${inputs.shopName} in ${inputs.area}`,
        tagline: content.hero?.tagline || "Elite Grooming Standards",
        imageUrl: imageUrls[0] || "",
      },
      about: {
        heading: content.about?.heading || "The Artisan Standard",
        description: content.about?.paragraphs || ["Dedicated to traditional craft and modern style."],
        imageUrl: imageUrls[1] || "",
      },
      services: (content.services || []).map((s: any, i: number) => ({
        ...s,
        icon: serviceIcons[i % 4],
        imageUrl: imageUrls[i + 2] || imageUrls[2] || "",
      })),
      gallery: imageUrls.filter(url => url !== ""),
      contact: content.contact || { 
        address: inputs.area, 
        email: `contact@${inputs.shopName.toLowerCase().replace(/\s/g, '')}.com` 
      },
    };

    return res.status(200).json(finalData);

  } catch (error: any) {
    console.error("Gemini API Error:", error);
    return res.status(500).json({ 
      message: error.message || "Failed to generate website content." 
    });
  }
}
