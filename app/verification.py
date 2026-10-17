"""Small deterministic checks, not a claim of general mathematical verification."""
import re
from collections import Counter

LIST = r"(?:\[\s*-?\d+(?:\s*,\s*-?\d+)*\s*\]|\{\s*-?\d+(?:\s*,\s*-?\d+)*\s*\})"


def equal_partition_question(question):
    return bool(re.search(r"\bpartition equal subset sum\b|\bequal (?:sum )?partition\b",question,re.I))


def values(literal):
    return [int(n) for n in re.findall(r"-?\d+",literal)]


def prose_only(text):
    return re.sub(r"```[\s\S]*?```", "",text).replace("`", "").replace("**", "")


def binary_search_issues(question, prose):
    """Catch the common off-by-one when a logarithmic bound becomes an exact count.

    Restrict literal count checks to an explicitly stated array size and worst case;
    a particular search trace or the number of halvings can legitimately be smaller.
    """
    if not re.search(r"\bbinary search\b",question,re.I):
        return []
    errors=[]
    normalized=prose.replace("₂","2").replace("\u202f"," ").replace("\u00a0"," ")
    if re.search(r"(?:at most|maximum|worst.case)[^.!?\n]{0,100}(?:⌈|\\lceil|ceil)\s*\\?log[^.!?\n]{0,30}\bn\b[^.!?\n]{0,60}(?:steps|iterations|comparisons)",normalized,re.I):
        errors.append("Do not state ceil(log2(n)) as the exact upper bound on standard inclusive-interval binary-search iterations. O(log n) is asymptotic; exact counts depend on the loop and comparison convention. Remove or correct the exact-count claim.")
    for match in re.finditer(r"(?:worst.case|maximum)[^.!\n]{0,140}array\s+(?:of\s+)?size\s+(\d+)\b([^.!\n]{0,180})",normalized,re.I):
        n=int(match[1])
        count=re.search(r"(?:=|is|are|takes)\s*(\d+)\s*(?:comparisons|iterations|steps)\b",match[2],re.I)
        if n>0 and count and int(count[1]) < n.bit_length():
            errors.append("An exact worst-case count was inferred from log2(n). Standard inclusive-interval binary search can take floor(log2(n))+1 iterations for n>=1; do not confuse iterations, halvings and individual comparisons. Prefer a supported O(log n) recall question.")
    return errors


def answer_issues(question, text, mode="explain"):
    """Check literal partition examples and explicitly requested complexity coverage.

    Only integer-list examples are checked. This does not prove arbitrary model
    claims, program correctness, or that a cited excerpt entails every sentence.
    """
    prose=prose_only(text)
    errors=binary_search_issues(question,prose)
    if (mode == "complexity" or re.search(r"\bcomplexit(?:y|ies)\b|जटिलता",question,re.I)) and not re.search(
            r"\bcomplexit(?:y|ies)\b|\bO\s*\(|जटिलता",prose,re.I):
        errors.append("The question requests complexity. Give the supported bound, or explicitly state that the supplied excerpts do not establish it.")
    if not equal_partition_question(question):
        return errors
    # A user-supplied array takes precedence over the model's example.
    supplied=[m for m in re.finditer(LIST,question) if "," in m[0]]
    arrays=list(re.finditer(r"\b(?:array|input|nums)\s*(?:is|=|:)?\s*("+LIST+r")",prose,re.I))
    if not arrays:
        return errors
    # Check each clearly labelled example against its own following explanation.
    for i, array in enumerate(arrays):
        original=values(supplied[0][0]) if len(supplied)==1 else values(array[1])
        if not original:
            continue
        section=prose[array.end():arrays[i+1].start() if i+1<len(arrays) else len(prose)]
        total=sum(original)
        pattern=r"\btotal(?:\s+sum)?(?:\s+of\s+(?:the\s+)?array)?\s*(?:is|equals|becomes|of|=|:)\s*(\d+(?:\s*\+\s*\d+)*)(?:\s*=\s*(\d+))?"
        for claim in re.finditer(pattern,section,re.I):
            expression=sum(int(n) for n in re.findall(r"\d+",claim[1]))
            stated=int(claim[2]) if claim[2] else expression
            if stated != total or expression != total:
                errors.append(f"The input {original} sums to {total}, not the stated total {stated}.")
            parity=re.match(r"\s*[,;]?\s*(?:which\s+is|is|so\s+it\s+is)\s+(odd|even)\b",section[claim.end():],re.I)
            if parity and (total%2==0) != (parity[1].lower()=="even"):
                errors.append(f"The total {total} has the wrong claimed parity.")
        for pair in re.finditer("("+LIST+r")\s*(?:and|&)\s*("+LIST+")",section,re.I):
            before=section[max(0,pair.start()-70):pair.start()].lower()
            after=section[pair.end():pair.end()+90].lower()
            # It is valid to demonstrate that a proposed partition fails.
            if re.search(r"\binvalid\b|\bnot (?:a )?valid\b|\bunequal\b|\bnot equal\b",before+" "+after):
                continue
            left,right=values(pair[1]),values(pair[2])
            if Counter(left)+Counter(right) != Counter(original):
                errors.append("The proposed subsets do not use exactly the input elements and multiplicities.")
            if sum(left) != sum(right):
                errors.append(f"The proposed subsets sum to {sum(left)} and {sum(right)}; they are not equal.")
            both=re.search(r"\bboth\s+(?:summing|sum)\s+to\s+(\d+)",after)
            if both and (sum(left)!=int(both[1]) or sum(right)!=int(both[1])):
                errors.append("The claimed common subset sum is incorrect.")
    return list(dict.fromkeys(errors))


def illustration_hint(question):
    if not equal_partition_question(question) or re.search(LIST,question):
        return ""
    original,left,right=[1,5,11,5],[11],[1,5,5]
    assert Counter(left)+Counter(right)==Counter(original) and sum(left)==sum(right)
    return (f"For a numerical illustration, you may use input {original}: total {sum(original)}, "
            "subsets {"+", ".join(map(str,left))+"} and {"+", ".join(map(str,right))+f"}}, each summing to {sum(left)}. "
            "This is an application-checked illustration derived from the partition rule, not a quotation or claim about the lecture's example. "
            "Preserve every input value and multiplicity. State complexity separately if requested, and only when the excerpts support it.")
