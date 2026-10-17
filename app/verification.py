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
    for claim in re.finditer(r"(?:at most|maximum|worst.case)([^.!?\n]{0,100}log[^.!?\n]{0,30}\bn\b[^.!?\n]{0,60}(?:steps|iterations|comparisons))",normalized,re.I):
        if not re.search(r"\bO\s*\\?\(",claim[1]):
            errors.append("Do not state log2(n) or ceil(log2(n)) as the exact upper bound on standard inclusive-interval binary-search iterations. O(log n) is asymptotic; exact counts depend on the loop and comparison convention. Remove or correct the exact-count claim.")
    for match in re.finditer(r"(?:worst.case|maximum)[^.!\n]{0,140}array\s+(?:of\s+)?size\s+(\d+)\b([^.!\n]{0,180})",normalized,re.I):
        n=int(match[1])
        count=re.search(r"(?:=|is|are|takes)\s*(\d+)\s*(?:comparisons|iterations|steps)\b",match[2],re.I)
        if n>0 and count and int(count[1]) < n.bit_length():
            errors.append("An exact worst-case count was inferred from log2(n). Standard inclusive-interval binary search can take floor(log2(n))+1 iterations for n>=1; do not confuse iterations, halvings and individual comparisons. Prefer a supported O(log n) recall question.")
    return errors


def partition_trace_issues(original, section):
    """Check explicit small reachable-sum traces against the displayed input.

    This only handles the simple 'after processing x -> {sums}' format. Keep
    verification bounded; larger examples should omit unverified state tables.
    """
    traces=list(re.finditer(r"\bafter\s+((?:(?:processing|the|final|last)\s+)*)(\d+)\s*(?:→|->|:)\s*("+LIST+")",section,re.I))
    if not traces:
        return []
    if len(original)>40 or sum(original)>10000 or any(n<0 for n in original):
        return ["Omit the intermediate reachable-sum trace; this example is outside the supported deterministic trace-check limits."]
    target=sum(original)//2
    cursor=-1;reachable={0};errors=[]
    for trace in traces:
        value=int(trace[2])
        positions=[i for i in range(cursor+1,len(original)) if original[i]==value]
        if not positions:
            errors.append("The DP trace processes an element not present at that point in the input. Remove the trace and show the checked partition instead.")
            break
        end=positions[-1] if re.search(r"\b(?:final|last)\b",trace[1],re.I) else positions[0]
        for number in original[cursor+1:end+1]:
            reachable |= {s+number for s in reachable if s+number<=target}
        cursor=end
        stated=set(values(trace[3]))
        # Explanatory lists sometimes omit the always-reachable empty sum 0.
        if stated-{0} != reachable-{0}:
            expected=", ".join(map(str,sorted(reachable))) if len(reachable)<=25 else "the correctly computed states up to target"
            errors.append(f"The reachable-sum trace after {value} is incorrect for target {target}. Expected {expected}; sums above the target are not stored by this bounded DP. Correct or omit the intermediate trace and retain the checked partition example.")
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
        errors.extend(partition_trace_issues(original,section))
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
            "Preserve every input value and multiplicity. Prefer explaining the target reduction and checking these two subset sums; do not invent intermediate DP tables or reachable-sum lists. State complexity separately if requested, and only when the excerpts support it.")
