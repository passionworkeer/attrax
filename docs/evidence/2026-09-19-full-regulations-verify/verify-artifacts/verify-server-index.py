import json

idx = json.load(open("/opt/attrax/data/regulations/regulations_index.json"))
regs = idx["regulations"]
print("server count:", idx["count"], "/ len:", len(regs))

for want in ["CN-CCC", "CN-CCC-IT", "CN-CSAR", "KR-KLRI-ELAW", "KR-MOTIE-KC",
             "UK-UKCA-Appliance", "AE-MoIAT-ECAS", "SA-SASO-Saber", "SA-SABER-SASO",
             "BR-INMETRO", "JP-METI-PSE", "UN-38-3", "US-CPSC-General", "AU-RCM"]:
    r = next((x for x in regs if x["id"] == want), None)
    if r is None:
        print(want, ": MISSING!")
    else:
        print(want, ":", r["source_url"])

for gone in ["KR-KR_-_-_KLRI", "KR-KR_-_KLRI_"]:
    r = next((x for x in regs if x["id"] == gone), None)
    print(gone, ": ", "still present!" if r else "removed", sep="")

uk = sorted(x["id"] for x in regs
            if x["region"] == "UK" and x["id"] in ("UK-Packaging-EPR", "UK-REACH", "UK-WEEE"))
print("watchdog UK entries intact:", uk)
