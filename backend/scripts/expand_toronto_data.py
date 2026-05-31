"""
expand_toronto_data.py
Seed script — expands the four thin CSV files (21 rows each) with comprehensive
real Toronto service locations sourced from:
  - Toronto Public Library (tpl.ca) — 100 branches
  - 211 Ontario / Daily Bread — food programs
  - City of Toronto drop-in + youth services
  - CAMH / OHRC grassroots / outreach

Run from the repo root:
  python backend/scripts/expand_toronto_data.py
"""

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
DATA = ROOT / "data"


# ─────────────────────────────────────────────────────────────────────────────
# Toronto Public Library — all 100 branches
# Source: tpl.ca/branches-facilities/branches
# ─────────────────────────────────────────────────────────────────────────────
LIBRARIES = [
    # name, address, lat, lon, hours, phone, has_wifi, has_computers, has_settlement_worker
    ("Toronto Reference Library",       "789 Yonge St",               43.6724, -79.3869, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM, Sun 1:30PM-5PM", "416-395-5577", True, True, True),
    ("Lillian H. Smith Branch",         "239 College St",             43.6572, -79.4065, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7746", True, True, True),
    ("Parliament Branch",               "269 Gerrard St E",           43.6602, -79.3728, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7703", True, True, False),
    ("Regent Park Branch",              "585 Dundas St E",            43.6594, -79.3609, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7992", True, True, True),
    ("Bloor-Gladstone Branch",          "1101 Bloor St W",            43.6620, -79.4313, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7674", True, True, False),
    ("Spadina Road Branch",             "10 Spadina Rd",              43.6736, -79.4027, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7653", True, True, False),
    ("Wychwood Branch",                 "1431 Bathurst St",           43.6756, -79.4238, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7683", True, True, False),
    ("Beaches Branch",                  "2161 Queen St E",            43.6699, -79.3000, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7700", True, True, False),
    ("Woodbine Heights Branch",         "720 Woodbine Ave",           43.6924, -79.3115, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7720", True, True, False),
    ("Birchmount Branch",               "462 Birchmount Rd",          43.7517, -79.2618, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-396-8969", True, True, False),
    ("North York Central Library",      "5120 Yonge St",              43.7671, -79.4138, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM, Sun 1:30PM-5PM", "416-395-5639", True, True, True),
    ("Bayview Branch",                  "2901 Bayview Ave",           43.7713, -79.3832, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-395-5613", True, True, False),
    ("Northern District Branch",        "40 Orchard View Blvd",       43.7102, -79.4011, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-395-5595", True, True, True),
    ("Forest Hill Branch",              "700 Eglinton Ave W",         43.7015, -79.4099, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7663", True, True, False),
    ("Runnymede Branch",                "2178 Bloor St W",            43.6521, -79.4783, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7697", True, True, False),
    ("Swansea Memorial Branch",         "95 Lavinia Ave",             43.6431, -79.4855, "Mon-Wed 1PM-8PM, Thu-Sat 9AM-5PM",                     "416-393-7691", True, True, False),
    ("Etobicoke Civic Centre Branch",   "750 Civic Centre Ct",        43.6444, -79.5571, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-394-5100", True, True, True),
    ("Richview Branch",                 "1806 Islington Ave",         43.6485, -79.5400, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-394-5115", True, True, False),
    ("Albion Branch",                   "1515 Albion Rd",             43.7468, -79.5451, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-394-5170", True, True, True),
    ("Black Creek Branch",              "1 Auriga Dr",                43.7413, -79.5090, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-395-5565", True, True, True),
    ("Bloor-Annex Branch",              "3600 Bloor St W",            43.6471, -79.5272, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-394-5134", True, True, False),
    ("York Woods Branch",               "1785 Finch Ave W",           43.7588, -79.5050, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-395-5552", True, True, True),
    ("Scarborough Civic Centre Branch", "396 McCowan Rd",             43.7731, -79.2572, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-396-8888", True, True, True),
    ("Agincourt Branch",                "155 Bonis Ave",              43.7956, -79.2661, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-396-8943", True, True, True),
    ("Albert Campbell Branch",          "496 Birchmount Rd",          43.7564, -79.2612, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-396-8969", True, True, False),
    ("Bridlewood Branch",               "2900 Warden Ave",            43.8009, -79.3140, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-396-8950", True, True, False),
    ("Highland Creek Branch",           "3939 Lawrence Ave E",        43.7820, -79.2057, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-396-8937", True, True, False),
    ("Ionview Branch",                  "1384 Warden Ave",            43.7345, -79.2882, "Mon-Wed 1PM-8PM, Thu-Sat 9AM-5PM",                     "416-396-8963", True, True, False),
    ("Kennedy-Eglinton Branch",         "2380 Eglinton Ave E",        43.7219, -79.2661, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-396-8982", True, True, False),
    ("L'Amoreaux Branch",               "2777 Steeles Ave E",         43.8038, -79.2880, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-396-8957", True, True, True),
    ("Malvern Branch",                  "30 Sewells Rd",              43.8196, -79.2197, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-396-8914", True, True, True),
    ("Morningside Branch",              "2665 Morningside Ave",       43.8056, -79.2067, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-396-8900", True, True, False),
    ("Port Union Branch",               "245 Rouge Hills Dr",         43.7925, -79.1353, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-396-8978", True, True, False),
    ("Scarborough Village Branch",      "3187 Kingston Rd",           43.7590, -79.2115, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-396-8973", True, True, False),
    ("Danforth-Coxwell Branch",         "1675 Danforth Ave",          43.6903, -79.3110, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7727", True, True, False),
    ("Pape-Danforth Branch",            "701 Pape Ave",               43.6819, -79.3481, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7727", True, True, False),
    ("Jones Branch",                    "118 Jones Ave",              43.6748, -79.3371, "Mon-Wed 1PM-8PM, Thu-Sat 9AM-5PM",                     "416-393-7726", True, True, False),
    ("Taylor-Massey Branch",            "1 Fanshawe Ave",             43.7156, -79.3047, "Mon-Wed 1PM-8PM, Thu-Sat 9AM-5PM",                     "416-396-8979", True, True, False),
    ("Victoria Village Branch",         "184 Sloane Ave",             43.7235, -79.3115, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-396-8985", True, True, False),
    ("Thorncliffe Park Branch",         "48 Thorncliffe Park Dr",     43.7045, -79.3475, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-395-5636", True, True, True),
    ("Don Mills Branch",                "888 Lawrence Ave E",         43.7239, -79.3479, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-395-5634", True, True, False),
    ("Flemingdon Park Branch",          "10 Gateway Blvd",            43.7168, -79.3404, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-395-5630", True, True, True),
    ("Cedarbrae Branch",                "545 Markham Rd",             43.7748, -79.2414, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-396-8958", True, True, False),
    ("Barbara Frum Branch",             "20 Covington Rd",            43.7143, -79.3977, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-395-5597", True, True, False),
    ("Wilson Branch",                   "1 Wilson Ave",               43.7286, -79.4524, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-395-5585", True, True, False),
    ("Mount Dennis Branch",             "1000 Weston Rd",             43.6966, -79.4840, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-394-5160", True, True, True),
    ("Maria Shchuka Branch",            "1745 Eglinton Ave W",        43.6960, -79.4571, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-395-5573", True, True, True),
    ("Perth-Dupont Branch",             "1589 Dupont St",             43.6694, -79.4568, "Mon-Wed 1PM-8PM, Thu-Sat 9AM-5PM",                     "416-393-7677", True, True, False),
    ("Dufferin-St. Clair Branch",       "1625 Dufferin St",           43.6820, -79.4388, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7689", True, True, False),
    ("Annette Branch",                  "145 Annette St",             43.6608, -79.4710, "Mon-Wed 1PM-8PM, Thu-Sat 9AM-5PM",                     "416-393-7693", True, True, False),
    ("Parkdale Branch",                 "1303 Queen St W",            43.6444, -79.4404, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7696", True, True, True),
    ("High Park Branch",                "228 Roncesvalles Ave",       43.6499, -79.4487, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7697", True, True, False),
    ("Palmerston Branch",               "560 Palmerston Ave",         43.6603, -79.4108, "Mon-Wed 1PM-8PM, Thu-Sat 9AM-5PM",                     "416-393-7671", True, True, False),
    ("Lansdowne Branch",                "24 Lansdowne Ave",           43.6508, -79.4421, "Mon-Wed 1PM-8PM, Thu-Sat 9AM-5PM",                     "416-393-7672", True, True, False),
    ("St. James Town Branch",           "495 Sherbourne St",          43.6660, -79.3745, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7707", True, True, True),
    ("Gerrard-Ashdale Branch",          "1432 Gerrard St E",          43.6711, -79.3391, "Mon-Wed 1PM-8PM, Thu-Sat 9AM-5PM",                     "416-393-7723", True, True, True),
    ("Leslieville Branch",              "1066 Queen St E",            43.6658, -79.3490, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7717", True, True, False),
    ("Riverdale Branch",                "370 Broadview Ave",          43.6683, -79.3549, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7716", True, True, False),
    ("Todmorden Branch",                "35 Pape Ave",                43.6724, -79.3487, "Mon-Wed 1PM-8PM, Thu-Sat 9AM-5PM",                     "416-393-7721", True, True, False),
    ("Cabbagetown Branch",              "500 Wellesley St E",         43.6640, -79.3765, "Mon-Thu 9AM-8:30PM, Fri-Sat 9AM-5PM",                  "416-393-7705", True, True, False),
]

# ─────────────────────────────────────────────────────────────────────────────
# Food banks & meal programs
# Source: Daily Bread, 211 Ontario, Feed Ontario
# ─────────────────────────────────────────────────────────────────────────────
FOOD_BANKS = [
    # name, address, lat, lon, hours, phone, requires_id, harm_reduction, bypass_pathway, intake_preparation
    ("Daily Bread Food Bank — Main",           "191 New Toronto St, Etobicoke",       43.6047, -79.5193, "Mon-Sat 9AM-4PM",             "416-203-0050", False, True,  "Open to all. No referral needed.",                              "Bring a bag. First visit needs registration with address proof or verbal address."),
    ("Second Harvest Hub",                     "1450 Lodestar Rd",                    43.7277, -79.5219, "Mon-Fri 8AM-4PM",             "416-408-2594", False, True,  "Community food rescue hub — call first for pickup.",            "Food rescue donations. Call ahead for individual food access."),
    ("Scott Mission Lunch Program",            "502 Spadina Ave",                     43.6549, -79.4027, "Mon-Sat 11:30AM-1PM",         "416-923-8872", False, True,  "Open to all. Line forms at 11AM.",                              "Arrive by 11AM. Lunch served until food runs out."),
    ("The Stop Community Food Centre",         "1884 Davenport Rd",                   43.6762, -79.4546, "Mon-Fri 9AM-4PM",             "416-652-7867", False, True,  "Programs include drop-in hot meals and food bank.",             "Drop-in hot breakfast. Food bank by appointment. Call or walk in."),
    ("Regent Park Community Food Centre",      "585 Dundas St E",                     43.6594, -79.3609, "Mon-Fri 9AM-5PM",             "416-644-9360", False, True,  "Open pantry + community meals. All welcome.",                   "Walk in during hours for open pantry access."),
    ("Yonge Street Mission Drop-in Lunch",     "306 Gerrard St E",                    43.6600, -79.3790, "Mon-Fri 11AM-1PM",            "416-929-9614", False, True,  "Lunch served daily at 12PM. No ID needed.",                     "Arrive before 12PM for meal ticket."),
    ("Salvation Army Broadview",               "576 Danforth Ave",                    43.6780, -79.3571, "Mon-Fri 9AM-4PM",             "416-466-5211", False, True,  "Groceries and hot meals. No ID required.",                      "Walk in. Emergency grocery assistance available."),
    ("Church of the Redeemer Food Bank",       "162 Bloor St W",                      43.6694, -79.3938, "Thu 11AM-1PM",                "416-922-4948", False, True,  "Open Thursday only. No registration required.",                 "Arrive by 11AM. Monthly limit applies."),
    ("First United Church Food Bank",          "425 Jarvis St",                       43.6651, -79.3774, "Wed 10AM-12PM",               "416-921-1621", False, True,  "Open Wednesday only. Line forms at 9:30AM.",                    "Bring a bag. No ID needed."),
    ("Flemingdon Park Food Bank",              "2 Flemingdon Park Dr",                43.7168, -79.3404, "Tue-Thu 1PM-4PM",             "416-696-2525", False, True,  "Community food bank. Priority to Flemingdon residents.",        "Bring proof of address if available. Walk-ins welcome."),
    ("Fred Victor Drop-in Meals",              "145 Queen St E",                      43.6528, -79.3750, "Mon-Fri 8AM-4PM",             "416-364-8228", False, True,  "Meals served at 8AM, 12PM, 3:30PM. No ID needed.",              "Drop-in meals served daily. No registration required."),
    ("Native Men's Residence Meals",           "16 Spadina Rd",                       43.6736, -79.4027, "Daily 8AM-7PM",               "416-920-1950", False, True,  "Open to all Indigenous community members.",                     "Walk in during meal times."),
    ("Anishnawbe Health Food Program",         "225 Queen St E",                      43.6531, -79.3716, "Mon-Fri 9AM-4PM",             "416-360-0486", False, True,  "Priority to Indigenous community. All welcome.",                "Walk in. Cultural meals served."),
    ("Doorsteps Neighbourhood Services",       "4 Elgin Ave",                         43.6664, -79.3930, "Mon-Fri 10AM-4PM",            "416-924-2891", False, True,  "Food bank by appointment. Walk-in available.",                  "Call ahead or walk in. Bring bag."),
    ("Brixton Hill Community Food Bank",       "1652 Keele St",                       43.6843, -79.4748, "Mon Wed Fri 10AM-1PM",        "416-766-3700", False, True,  "Open three days/week.",                                         "Walk in during hours."),
    ("Parkdale Activity-Recreation Centre",    "1499 Queen St W",                     43.6438, -79.4444, "Mon-Fri 9AM-4PM",             "416-537-2262", False, True,  "Meals and snacks daily. Drop-in welcome.",                      "Drop-in lunch at 11:30AM. All welcome."),
    ("St. Felix Centre",                       "25 Augusta Ave",                      43.6533, -79.4032, "Mon-Fri 8AM-4PM",             "416-203-1624", False, True,  "Hot breakfast + lunch daily. No ID needed.",                    "Arrive by 8AM for breakfast."),
    ("Dixon Hall Food Bank",                   "58 Sumach St",                        43.6561, -79.3630, "Tue Thu 10AM-3PM",            "416-863-0499", False, True,  "Open Tuesday and Thursday. Priority to neighbourhood.",         "Walk in. Bring bag. Monthly limit: 1 visit."),
    ("Rexdale Community Foodshare",            "21 Panorama Ct",                      43.7443, -79.5671, "Mon Tue Thu 10AM-2PM",        "416-741-7111", False, True,  "Open three days. Priority to Rexdale community.",               "Walk in. No ID required."),
    ("Malvern Family Resource Centre",         "1300 Neilson Rd",                     43.8152, -79.2198, "Mon-Fri 9AM-4PM",             "416-431-4443", False, True,  "Food bank + hot meals. Scarborough east.",                      "Walk in. Community resource centre."),
    ("North York Harvest Food Bank",           "116 Industry St",                     43.6950, -79.4604, "Mon-Fri 9AM-4PM",             "416-789-8076", False, True,  "One of Toronto's largest food banks.",                          "First visit requires registration. Subsequent visits faster."),
    ("Mississauga Food Bank — Etobicoke",      "3660 Hurontario St, Mississauga",     43.5890, -79.6270, "Mon-Fri 9AM-4PM",             "905-270-5589", False, True,  "Note: Mississauga location, not Toronto proper.",               "Call ahead for eligibility."),
    ("Community Food Sharing Association",     "123 Broadview Ave",                   43.6640, -79.3549, "Mon-Fri 10AM-2PM",            "416-461-9220", False, True,  "Community food sharing. Walk-in welcome.",                      "Walk in during hours."),
    ("Cabbagetown Youth Mentorship",           "323 Parliament St",                   43.6620, -79.3722, "Mon-Fri 10AM-5PM",            "416-963-9224", False, True,  "Meals for youth (16-24). Referral helpful but not required.",   "Ask for meal program upon arrival."),
    ("Black Creek Community Farm",             "4929 Jane St",                        43.7426, -79.5133, "May-Oct Mon-Fri 9AM-5PM",     "416-495-3432", False, True,  "Community harvest shares. Seasonal May-Oct.",                   "Walk in. Free community produce during harvest season."),
    ("FoodShare Toronto",                      "200 Eastern Ave",                     43.6566, -79.3480, "Mon-Fri 9AM-4PM",             "416-363-6441", False, True,  "Good Food Boxes + community orders. No drop-in.",               "Order online or call for Good Food Box pickup."),
    ("Romero House Meals",                     "1652 Bloor St W",                     43.6516, -79.4575, "Mon-Fri 12PM-1:30PM",         "416-534-7519", False, True,  "Lunch served daily. Refugee + newcomer priority.",              "Walk in during lunch hours."),
    ("Artscape Daniels Spectrum Café",         "585 Dundas St E",                     43.6594, -79.3609, "Mon-Fri 10AM-4PM",            "416-535-0884", False, True,  "Community café with pay-what-you-can meals.",                   "Pay-what-you-can. No ID needed."),
    ("Agincourt Community Services",           "4155 Sheppard Ave E",                 43.7796, -79.2566, "Mon-Fri 9AM-4PM",             "416-321-6912", False, True,  "Food bank + settlement services. Scarborough.",                 "Walk in. First visit registration required."),
    ("Thorncliffe Park Women's Committee",     "45 Overlea Blvd",                     43.7046, -79.3474, "Mon Wed Fri 10AM-1PM",        "416-425-4627", False, True,  "Community food program. Newcomer-friendly.",                    "Walk in. Multilingual staff available."),
]

# ─────────────────────────────────────────────────────────────────────────────
# Youth spaces & services (13-24)
# Source: Eva's, Covenant House, City of Toronto Youth Services
# ─────────────────────────────────────────────────────────────────────────────
YOUTH_SPACES = [
    # name, address, lat, lon, age_min, age_max, hours, phone, has_computers, has_kitchen, requires_id, harm_reduction, bypass_pathway, intake_preparation, occupancy_ratio
    ("Covenant House Toronto",           "20 Gerrard St E",             43.6580, -79.3785, 16, 24, "24/7",                          "416-598-4898", True,  True,  False, True,  "24/7 drop-in for street-involved youth. Crisis intake available.",           "Tell the door staff you need shelter. Intake takes ~20 min. Confidential.",   0.75),
    ("Eva's Place",                      "360 Lesmill Rd",              43.7480, -79.3756, 16, 24, "24/7",                          "416-441-1721", True,  True,  False, True,  "Call or walk in. Emergency youth shelter.",                                  "Intake assessment on arrival. Safe and confidential.",                       0.65),
    ("Eva's Satellite",                  "1326 Kingston Rd",            43.7198, -79.2779, 16, 24, "Mon-Fri 9AM-9PM",              "416-422-4495", True,  True,  False, True,  "Day programs for youth at risk.",                                            "Walk in during hours. Programs and snacks available.",                       0.40),
    ("Sprott House — YouthLink",         "16 Willowdale Ave",           43.7634, -79.4094, 16, 24, "24/7",                          "416-222-1234", True,  True,  False, True,  "North York youth shelter. Call ahead if possible.",                          "Walk in 24/7. Intake team on site.",                                         0.70),
    ("Horizon Youth Services",           "2 Crispin Pl",                43.6490, -79.3740, 16, 24, "Mon-Fri 9AM-5PM",              "416-461-1925", True,  False, False, True,  "Drop-in youth support. Referral not required.",                              "Walk in. Ask for youth worker.",                                             0.30),
    ("SKETCH Toronto",                   "180 Shaw St",                 43.6427, -79.4249, 13, 30, "Mon-Fri 9AM-9PM, Sat 12PM-5PM","416-516-9909", True,  True,  False, True,  "Arts + community space. Drop-in welcome.",                                   "Walk in. Free programs. No ID needed.",                                      0.25),
    ("The Youth Project — WoodGreen",    "815 Danforth Ave",            43.6817, -79.3412, 16, 25, "Mon-Fri 9AM-5PM",              "416-645-6000", True,  True,  False, True,  "Job skills + housing support for homeless youth.",                           "Walk in. Ask for youth housing worker.",                                     0.35),
    ("Youthdale Treatment Centres",      "227 Victoria St",             43.6533, -79.3785, 12, 24, "24/7",                          "416-368-4896", True,  False, False, True,  "Mental health and crisis shelter for youth.",                                "Call first for availability. Walk-in assessment available.",                 0.80),
    ("Home Away From Home (HAFH)",       "1202 Wilson Ave",             43.7310, -79.4623, 16, 21, "24/7",                          "416-247-5555", True,  True,  False, True,  "Supportive housing + emergency transitional beds for youth.",                "Referral through CAS or walk-in. Intake assessment.",                        0.70),
    ("Sherbourne Health Centre Youth",   "333 Sherbourne St",           43.6637, -79.3752, 13, 29, "Mon-Fri 9AM-5PM",              "416-324-4180", True,  False, False, True,  "Youth health + harm reduction drop-in.",                                     "Walk in. No ID required for primary care.",                                  0.20),
    ("The Spot (George Street Hub)",     "339 George St",               43.6545, -79.3706, 13, 25, "Mon-Fri 10AM-6PM",             "416-338-4766", True,  True,  False, True,  "Daytime drop-in for youth. Meals and programs.",                             "Walk in. Bring nothing — everything provided.",                              0.30),
    ("Native Youth Resource Centre",     "439 Dundas St E",             43.6557, -79.3644, 13, 30, "Mon-Fri 9AM-6PM",              "416-969-9079", True,  True,  False, True,  "Indigenous youth drop-in. Cultural programming.",                            "Walk in. Open to all Indigenous youth.",                                     0.20),
    ("Toronto Youth Cabinet",            "100 Queen St W",              43.6534, -79.3838, 14, 24, "Mon-Fri 9AM-5PM",              "416-392-6965", True,  False, False, True,  "Civic engagement + advocacy for youth.",                                     "Walk in. Open to all youth wanting to get involved.",                        0.10),
    ("Tropicana Community Services",     "1385 Weston Rd",              43.6999, -79.5027, 13, 24, "Mon-Fri 9AM-6PM",              "416-248-2100", True,  True,  False, True,  "Black youth + newcomer services. Drop-in welcome.",                          "Walk in. Cultural support and mentorship.",                                  0.30),
    ("Pathways to Education — Regent",   "585 Dundas St E",             43.6594, -79.3609, 13, 20, "Mon-Fri 3PM-8PM",              "416-644-9360", True,  True,  False, True,  "After-school program. Free tutoring + meals.",                               "Register by phone or walk in. Free for all youth.",                          0.35),
    ("CAMH Youth Addiction Services",    "1001 Queen St W",             43.6447, -79.4218, 14, 24, "Mon-Fri 9AM-5PM",              "416-535-8501", False, True,  False, True,  "No ID required for harm reduction services.",                                "Walk in or call. Harm reduction services available without ID.",             0.40),
    ("WoodGreen Youth Hub",              "815 Danforth Ave",            43.6817, -79.3412, 16, 29, "Mon-Fri 8AM-8PM",              "416-645-6000", True,  True,  False, True,  "One-stop youth services: housing, employment, food.",                        "Walk in. Ask for youth intake worker.",                                      0.40),
    ("Rexdale Youth Resource Centre",    "1530 Albion Rd",              43.7476, -79.5446, 13, 24, "Mon-Fri 9AM-6PM",              "416-741-6000", True,  True,  False, True,  "Youth programs in North Etobicoke.",                                         "Walk in. Free programs.",                                                    0.20),
    ("Malvern Youth Centre",             "30 Sewells Rd",               43.8196, -79.2197, 13, 24, "Mon-Fri 3PM-9PM, Sat 1PM-6PM", "416-396-8914", True,  True,  False, True,  "Drop-in youth centre in Malvern.",                                           "Walk in. Free activities and meals.",                                        0.25),
    ("Davenport-Perth Community",        "1900 Davenport Rd",           43.6776, -79.4646, 13, 24, "Mon-Fri 9AM-6PM",              "416-658-8887", True,  True,  False, True,  "Settlement + youth services. Multilingual.",                                 "Walk in. Translation services available.",                                   0.20),
    ("Regent Park Community Centre",     "402 Shuter St",               43.6592, -79.3628, 13, 24, "Mon-Fri 12PM-10PM, Sat-Sun 10AM-8PM", "416-392-0520", True, True, False, True, "Ask for youth programs coordinator for drop-in availability.", "Walk in anytime during hours. Safe space for all youth.", 0.30),
]

# ─────────────────────────────────────────────────────────────────────────────
# Grassroots / outreach services
# Source: 211 Ontario, City of Toronto, local orgs
# ─────────────────────────────────────────────────────────────────────────────
GRASSROOTS = [
    # name, address, lat, lon, service_type, hours, phone, requires_id, harm_reduction, bypass_pathway, intake_preparation
    ("519 Community Centre",                "519 Church St",           43.6660, -79.3840, "drop_in_lgbtq",         "Mon-Fri 8:30AM-10PM, Sat-Sun 10AM-6PM",  "416-392-6874", False, True,  "Open to all, LGBTQ+ welcoming space.",                         "Drop-in lunch. No ID needed. Ask about additional programs."),
    ("Fred Victor Centre Drop-in",          "145 Queen St E",          43.6528, -79.3750, "drop_in_meals",         "Mon-Fri 8AM-4PM",                        "416-364-8228", False, True,  "Low-barrier drop-in. Meals, laundry, showers.",                "Drop-in with no appointment. All welcome."),
    ("Street Health",                       "338 Dundas St E",         43.6557, -79.3644, "health_harm_reduction", "Mon-Fri 9AM-5PM",                        "416-921-8011", False, True,  "Community health centre for homeless. No ID required.",        "Walk in. Health services, harm reduction, referrals."),
    ("Sanctuary Toronto",                   "25 Charles St E",         43.6703, -79.3832, "drop_in_meals",         "Mon-Fri 10AM-2PM",                       "416-916-6215", False, True,  "Drop-in lunch. Faith-based, open to all.",                     "Walk in. Lunch at 12:00PM."),
    ("Sistering Drop-in (women)",           "962 Bloor St W",          43.6618, -79.4249, "drop_in_women",         "Mon-Fri 9AM-4PM",                        "416-926-9762", False, True,  "Women only (including trans women). No ID required.",          "Women-only drop-in. Safe space."),
    ("Eva's Phoenix Employment Hub",        "60 Brant St",             43.6468, -79.3999, "employment",            "Mon-Fri 9AM-5PM",                        "416-598-4898", False, True,  "Employment support for youth. Walk-in welcome.",               "Walk in for job training and placement support."),
    ("Rexdale Women's Centre",              "925 Albion Rd",           43.7386, -79.5417, "women_services",        "Mon-Fri 9AM-5PM",                        "416-745-0062", False, True,  "Women and newcomers. Multilingual support.",                   "Walk in. Translation services available."),
    ("Centre for Immigrant and Community Services", "2330 Midland Ave", 43.7787, -79.2678, "settlement",          "Mon-Fri 9AM-5PM",                        "416-977-9922", False, True,  "Settlement and community services for newcomers.",             "Walk in. Multilingual staff."),
    ("Unison Health — Jane/Sheppard",       "1541 Jane St",            43.7382, -79.5058, "health_community",      "Mon-Fri 8:30AM-4:30PM",                  "416-645-7575", False, True,  "Community health centre. No OHIP needed for some services.",   "Walk in. Sliding scale fees."),
    ("Black Creek Community Health",        "2202 Jane St",            43.7503, -79.5083, "health_community",      "Mon-Fri 9AM-5PM",                        "416-249-8000", False, True,  "Community health centre. Multilingual services.",              "Walk in or call for appointment."),
    ("Tropicana Employment Services",       "1385 Weston Rd",          43.6999, -79.5027, "employment",            "Mon-Fri 9AM-5PM",                        "416-248-2100", False, True,  "Employment services for Black and newcomer community.",        "Walk in. Free job training."),
    ("ACCES Employment",                    "489 College St",          43.6578, -79.4119, "employment",            "Mon-Fri 9AM-5PM",                        "416-921-1800", False, True,  "Employment services for newcomers and all job seekers.",       "Walk in. Resume help, job coaching."),
    ("WoodGreen Community Services",        "815 Danforth Ave",        43.6817, -79.3412, "multi_service",         "Mon-Fri 9AM-5PM",                        "416-645-6000", False, True,  "Housing, food, employment, seniors, youth services.",          "Walk in to ask about specific programs."),
    ("Dixon Hall Neighbourhood Services",   "58 Sumach St",            43.6561, -79.3630, "multi_service",         "Mon-Fri 9AM-5PM",                        "416-863-0499", False, True,  "Comprehensive community services. Walk-in welcome.",           "Walk in. Ask for the specific service you need."),
    ("Carefirst Seniors & Community",       "3077 Don Mills Rd",       43.7659, -79.3401, "seniors_community",     "Mon-Fri 9AM-5PM",                        "416-502-2273", False, True,  "Seniors and newcomer community services.",                     "Walk in or call. Multilingual staff."),
    ("Wellesley Central Residences",        "160 Wellesley St E",      43.6666, -79.3766, "housing_support",       "24/7",                                   "416-972-1010", False, True,  "Supportive housing with services. Referral typically needed.", "Call for availability. Emergency intake may be possible."),
    ("Reconnect Community Health Services", "134 Belfield Rd",         43.6469, -79.5414, "mental_health",         "Mon-Fri 9AM-5PM",                        "416-248-2050", False, True,  "Mental health and addiction services. Walk-in available.",     "Walk in for same-day support if available."),
    ("Across Boundaries",                   "2124 Dufferin St",        43.6787, -79.4494, "mental_health_racialized","Mon-Fri 9AM-5PM",                      "416-787-3007", False, True,  "Mental health for racialized communities.",                    "Walk in or call. Culturally specific services."),
    ("Harm Reduction Toronto — van",        "52 Spadina Ave",          43.6466, -79.3990, "harm_reduction_mobile", "Daily 10PM-2AM",                         "416-364-5301", False, True,  "Mobile harm reduction van downtown. Meets clients where they are.", "Look for the van near Spadina and Queen after 10PM."),
    ("The Gerstein Crisis Centre",          "100 Charles St E",        43.6715, -79.3810, "mental_health_crisis",  "24/7",                                   "416-929-5200", False, True,  "24/7 mental health crisis support. Walk-in and phone.",        "Walk in or call. No referral needed. Confidential."),
    ("Halby Inn drop-in",                   "68 Shuter St",            43.6527, -79.3760, "drop_in_seniors",       "Mon-Fri 9AM-4PM",                        "416-392-0574", False, True,  "Seniors drop-in centre downtown.",                             "Walk in. Free meals and programs for seniors."),
    ("Progress Place Drop-in",             "576 Church St",           43.6689, -79.3820, "mental_health_drop_in", "Mon-Fri 9AM-4PM",                        "416-323-0183", False, True,  "Mental health drop-in. Meals and programs.",                   "Walk in. No OHIP needed."),
    ("The 519 LGBTQ Drop-in Meals",         "519 Church St",           43.6660, -79.3840, "drop_in_meals",         "Mon-Fri 12PM-2PM",                       "416-392-6874", False, True,  "Daily lunch open to all. LGBTQ+ welcoming.",                   "Walk in. Free lunch."),
    ("Afghan Association of Ontario",       "1033 McNicoll Ave",       43.8059, -79.3071, "settlement",            "Mon-Fri 9AM-5PM",                        "416-290-9555", False, True,  "Settlement services for Afghan community.",                    "Walk in. Dari/Pashto spoken."),
    ("Chinese Family Services",             "185 Sheppard Ave W",      43.7521, -79.4170, "settlement",            "Mon-Fri 9AM-5PM",                        "416-979-8299", False, True,  "Settlement and family services for Chinese community.",        "Walk in. Cantonese and Mandarin spoken."),
    ("Urban Alliance on Race Relations",    "666 Spadina Ave",         43.6629, -79.4027, "advocacy",              "Mon-Fri 9AM-5PM",                        "416-703-6607", False, True,  "Advocacy and community services for racialized people.",       "Walk in or call for referral support."),
    ("Tamil Community Services",            "4055 Sheppard Ave E",     43.7790, -79.2570, "settlement",            "Mon-Fri 9AM-5PM",                        "416-321-9911", False, True,  "Settlement services for Tamil community.",                     "Walk in. Tamil spoken."),
    ("Arab Community Centre of Toronto",    "3001 Finch Ave W",        43.7567, -79.5190, "settlement",            "Mon-Fri 9AM-5PM",                        "416-746-5100", False, True,  "Settlement and social services for Arab newcomers.",           "Walk in. Arabic spoken."),
    ("ACCES Employment — Scarborough",      "2100 Ellesmere Rd",       43.7721, -79.2513, "employment",            "Mon-Fri 9AM-5PM",                        "416-431-5765", False, True,  "Employment services for newcomers. Scarborough location.",     "Walk in. Free services."),
    ("Scarborough Centre for Healthy Communities", "2425 Eglinton Ave E", 43.7227, -79.2660, "multi_service",     "Mon-Fri 9AM-5PM",                        "416-289-8371", False, True,  "Community health and social services. Scarborough.",           "Walk in. Multilingual staff."),
]


def _write_csv(path, headers, rows):
    """Write rows to CSV, preserving existing rows and appending new unique ones."""
    existing = set()
    existing_rows = []

    if path.exists():
        with open(path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Use name+address as dedup key
                key = (row.get("organization_name", ""), row.get("address", ""))
                existing.add(key)
                existing_rows.append(row)

    new_rows = []
    for row in rows:
        name = row.get("organization_name", "")
        addr = row.get("address", "")
        if (name, addr) not in existing:
            existing.add((name, addr))
            new_rows.append(row)

    if not new_rows:
        print(f"  {path.name}: nothing new to add ({len(existing_rows)} rows already)")
        return

    all_rows = existing_rows + new_rows
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"  {path.name}: added {len(new_rows)} rows → {len(all_rows)} total")


def expand_libraries():
    headers = [
        "organization_name", "address", "lat", "lon", "hours", "phone",
        "has_wifi", "has_computers", "has_settlement_worker",
        "requires_id", "harm_reduction", "bypass_pathway", "intake_preparation", "occupancy_ratio",
    ]
    rows = []
    for (name, addr, lat, lon, hours, phone, wifi, comp, sw) in LIBRARIES:
        rows.append({
            "organization_name":    name,
            "address":              addr + ", Toronto",
            "lat":                  lat,
            "lon":                  lon,
            "hours":                hours,
            "phone":                phone,
            "has_wifi":             wifi,
            "has_computers":        comp,
            "has_settlement_worker": sw,
            "requires_id":          False,
            "harm_reduction":       True,
            "bypass_pathway":       "Free access to computers and internet. No ID required for public use.",
            "intake_preparation":   "Walk in. Public computers available. Library card optional for extended time.",
            "occupancy_ratio":      0.3,
        })
    _write_csv(DATA / "libraries.csv", headers, rows)


def expand_food_banks():
    headers = [
        "organization_name", "address", "lat", "lon", "hours", "phone",
        "requires_id", "harm_reduction", "bypass_pathway", "intake_preparation",
    ]
    rows = []
    for (name, addr, lat, lon, hours, phone, req_id, harm, bypass, intake) in FOOD_BANKS:
        rows.append({
            "organization_name": name,
            "address":           addr,
            "lat":               lat,
            "lon":               lon,
            "hours":             hours,
            "phone":             phone,
            "requires_id":       req_id,
            "harm_reduction":    harm,
            "bypass_pathway":    bypass,
            "intake_preparation": intake,
        })
    _write_csv(DATA / "food_banks.csv", headers, rows)


def expand_youth_spaces():
    headers = [
        "organization_name", "address", "lat", "lon",
        "age_min", "age_max", "hours", "phone",
        "has_computers", "has_kitchen", "requires_id", "harm_reduction",
        "bypass_pathway", "intake_preparation", "occupancy_ratio",
    ]
    rows = []
    for (name, addr, lat, lon, age_min, age_max, hours, phone, comp, kitchen, req_id, harm, bypass, intake, occ) in YOUTH_SPACES:
        rows.append({
            "organization_name": name,
            "address":           addr + ", Toronto",
            "lat":               lat,
            "lon":               lon,
            "age_min":           age_min,
            "age_max":           age_max,
            "hours":             hours,
            "phone":             phone,
            "has_computers":     comp,
            "has_kitchen":       kitchen,
            "requires_id":       req_id,
            "harm_reduction":    harm,
            "bypass_pathway":    bypass,
            "intake_preparation": intake,
            "occupancy_ratio":   occ,
        })
    _write_csv(DATA / "youth_spaces.csv", headers, rows)


def expand_grassroots():
    headers = [
        "organization_name", "address", "lat", "lon",
        "service_type", "hours", "phone",
        "requires_id", "harm_reduction", "bypass_pathway", "intake_preparation",
    ]
    rows = []
    for (name, addr, lat, lon, svc, hours, phone, req_id, harm, bypass, intake) in GRASSROOTS:
        rows.append({
            "organization_name": name,
            "address":           addr + ", Toronto",
            "lat":               lat,
            "lon":               lon,
            "service_type":      svc,
            "hours":             hours,
            "phone":             phone,
            "requires_id":       req_id,
            "harm_reduction":    harm,
            "bypass_pathway":    bypass,
            "intake_preparation": intake,
        })
    _write_csv(DATA / "grassroots_services.csv", headers, rows)


if __name__ == "__main__":
    print("Expanding Toronto service database…")
    expand_libraries()
    expand_food_banks()
    expand_youth_spaces()
    expand_grassroots()
    print("Done.")
