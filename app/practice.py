"""Recall cards reuse cited notes; no generated distractors or invented grading."""
import hashlib
import re
from app.revision import SECTIONS, labels

QUESTIONS = {
    "English":("What is the goal and what assumptions are required?", "Why does the main approach work?",
               "Describe the steps or recurrence without looking.", "Work through a small example.",
               "What are the time and auxiliary space costs?", "Which pitfalls or boundary cases should you check?"),
    "Hindi":("लक्ष्य क्या है और कौन-सी शर्तें आवश्यक हैं?", "मुख्य तरीका क्यों काम करता है?",
             "बिना देखे चरण या रिकरेंस बताइए।", "एक छोटे उदाहरण को हल कीजिए।",
             "समय और सहायक स्पेस जटिलता क्या है?", "कौन-सी गलतियाँ या सीमा स्थितियाँ जाँचनी चाहिए?"),
    "Hinglish":("Goal aur zaroori assumptions kya hain?", "Main approach kyun kaam karta hai?",
                "Bina dekhe steps ya recurrence batao.", "Ek chhota example solve karo.",
                "Time aur auxiliary space complexity kya hai?", "Kaun se pitfalls ya boundary cases check karoge?"),
}


def practice_cards(result, language="English"):
    if not result.get("sources"):
        return []
    cards=[]
    headings=labels(language)
    questions=QUESTIONS.get(language,QUESTIONS["English"])
    if result.get("summary_type")=="revision_notes" and result.get("mode")=="generated":
        sections=re.split(r"(?m)^###\s+",result["answer"])[1:]
        for section in sections:
            title,_,answer=section.partition("\n")
            key=next((k for k,v in headings.items() if v.strip()==title.strip()),None)
            if not key or not answer.strip():
                continue
            refs={int(n) for n in re.findall(r"(?<!\w)\[(\d+)\]",answer)}
            sources=[s for s in result["sources"] if s["number"] in refs]
            if sources:
                cards.append({"section":key,"question":questions[SECTIONS.index(key)],"answer":answer.strip(),"sources":sources,"basis":"generated notes"})
    else:
        # Without a model, use original passages explicitly as reading/recall cards.
        for s in result["sources"][:4]:
            cards.append({"section":"passage","question":f"Recall the main idea from this lecture passage: {s['title']}",
                          "answer":s["text"]+f" [{s['number']}]","sources":[s],"basis":"original caption excerpt"})
    for c in cards:
        c["id"]=hashlib.sha256((c["section"]+c["question"]+c["answer"]+str([(s.get("video_id"),s.get("start")) for s in c["sources"]])).encode()).hexdigest()[:24]
    return cards
