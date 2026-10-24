"""Static catalog for the synthetic datasets (names, coordinates, product facts).

All values are synthetic design inputs. Coordinates are real city locations in
Maharashtra; prices and margins are illustrative rupee figures, not market data.
"""
from __future__ import annotations

# id, name, city, lat, lon, region, cold_storage, size_factor (drives outbound capacity)
WAREHOUSES = [
    ("W1", "Bhiwandi DC", "Bhiwandi", 19.2967, 73.0631, "Mumbai Metro", True, 1.35),
    ("W2", "Pune Hub", "Pune", 18.7606, 73.8636, "Western Maharashtra", True, 1.0),
    ("W3", "Nashik DC", "Nashik", 19.9975, 73.7898, "Mumbai Metro", True, 0.9),
    ("W4", "Aurangabad DC", "Chh. Sambhajinagar", 19.8762, 75.3433, "Vidarbha-Marathwada", False, 0.85),
    ("W5", "Nagpur DC", "Nagpur", 21.1458, 79.0882, "Vidarbha-Marathwada", True, 0.9),
]

REGIONS = ["Mumbai Metro", "Western Maharashtra", "Vidarbha-Marathwada"]

# id, city, lat, lon, region, remote, scale
OUTLET_SITES = [
    ("D1", "Andheri, Mumbai", 19.1197, 72.8468, "Mumbai Metro", False, 1.5),
    ("D2", "Thane", 19.2183, 72.9781, "Mumbai Metro", False, 1.3),
    ("D3", "Navi Mumbai", 19.0330, 73.0297, "Mumbai Metro", False, 1.2),
    ("D4", "Kalyan", 19.2403, 73.1305, "Mumbai Metro", False, 1.0),
    ("D5", "Pune", 18.5204, 73.8567, "Western Maharashtra", False, 1.45),
    ("D6", "Satara", 17.6805, 74.0183, "Western Maharashtra", False, 0.8),
    ("D7", "Kolhapur", 16.7050, 74.2433, "Western Maharashtra", False, 0.9),
    ("D8", "Sangli", 16.8524, 74.5815, "Western Maharashtra", False, 0.75),
    ("D9", "Chandrapur", 19.9615, 79.2961, "Vidarbha-Marathwada", True, 0.6),
    ("D10", "Gadchiroli", 20.1809, 79.9950, "Vidarbha-Marathwada", True, 0.5),
    ("D11", "Amravati", 20.9374, 77.7796, "Vidarbha-Marathwada", True, 0.7),
    ("D12", "Latur", 18.4088, 76.5604, "Vidarbha-Marathwada", True, 0.55),
]

# Per-module outlet type and storage capabilities, aligned with OUTLET_SITES order.
# storage: tuple of classes supported in addition to ambient; cold_factor scales cold capacity.
OUTLET_PROFILES = {
    "pharmacy": [
        ("hospital", "Lifeline Hospital", ("chilled", "2-8C"), 1.2),
        ("pharmacy", "Thane Wellness Pharmacy", ("2-8C",), 0.9),
        ("pharmacy", "Vashi Care Chemist", ("2-8C",), 0.8),
        ("clinic", "Kalyan Family Clinic", ("2-8C",), 0.6),
        ("hospital", "Deccan General Hospital", ("chilled", "2-8C"), 1.2),
        ("pharmacy", "Satara Medicals", ("2-8C",), 0.7),
        ("clinic", "Kolhapur Community Clinic", ("chilled",), 0.7),
        ("pharmacy", "Sangli Health Pharmacy", (), 0.0),
        ("clinic", "Chandrapur Rural Clinic", ("2-8C",), 0.35),
        ("clinic", "Gadchiroli Primary Clinic", ("2-8C",), 0.4),
        ("hospital", "Amravati District Hospital", ("chilled", "2-8C"), 1.0),
        ("pharmacy", "Latur Jan Pharmacy", ("2-8C",), 0.6),
    ],
    "grocery": [
        ("supermarket", "Andheri FreshMart", ("chilled",), 1.2),
        ("supermarket", "Thane DailyBasket", ("chilled",), 1.0),
        ("kirana", "Vashi Kirana Stores", ("chilled",), 0.5),
        ("kirana", "Kalyan General Stores", (), 0.0),
        ("supermarket", "Pune Super Bazaar", ("chilled",), 1.1),
        ("kirana", "Satara Kirana", ("chilled",), 0.4),
        ("supermarket", "Kolhapur Mega Mart", ("chilled",), 0.9),
        ("kirana", "Sangli Provision Store", (), 0.0),
        ("kirana", "Chandrapur Kirana", ("chilled",), 0.35),
        ("kirana", "Gadchiroli Village Store", (), 0.0),
        ("supermarket", "Amravati Value Mart", ("chilled",), 0.8),
        ("kirana", "Latur Kirana Bhandar", ("chilled",), 0.4),
    ],
    "cosmetics": [
        ("department_store", "Andheri Glam Department Store", ("chilled",), 1.0),
        ("beauty_store", "Thane Beauty Bar", ("chilled",), 0.8),
        ("salon", "Vashi Glow Salon", (), 0.0),
        ("beauty_store", "Kalyan Cosmetics Corner", ("chilled",), 0.5),
        ("department_store", "Pune Style Mall Store", ("chilled",), 1.1),
        ("salon", "Satara Bridal Salon", (), 0.0),
        ("beauty_store", "Kolhapur Beauty Hub", ("chilled",), 0.6),
        ("beauty_store", "Sangli Shringar Store", (), 0.0),
        ("salon", "Chandrapur Unisex Salon", ("chilled",), 0.35),
        ("beauty_store", "Gadchiroli Beauty Point", (), 0.0),
        ("department_store", "Amravati City Mall Store", ("chilled",), 0.9),
        ("salon", "Latur Glam Studio", ("chilled",), 0.4),
    ],
}

# name, category, storage_class, criticality, shelf_life_days, unit_volume_l,
# unit_cost_rs, unit_price_rs, base_daily_demand
PRODUCTS = {
    "pharmacy": [
        ("Insulin Glargine 100IU pen", "Antidiabetic", "2-8C", "critical", 540, 0.10, 520, 680, 3.0),
        ("Human Insulin 40IU vial", "Antidiabetic", "2-8C", "critical", 540, 0.06, 140, 190, 4.0),
        ("Metformin 500mg (strip of 10)", "Antidiabetic", "ambient", "critical", 1095, 0.02, 18, 30, 14.0),
        ("Amlodipine 5mg (strip of 10)", "Antihypertensive", "ambient", "critical", 1095, 0.02, 15, 26, 12.0),
        ("Salbutamol inhaler 100mcg", "Respiratory", "ambient", "critical", 730, 0.15, 110, 150, 3.5),
        ("Tetanus toxoid vaccine vial", "Vaccine", "2-8C", "standard", 730, 0.04, 22, 35, 3.0),
        ("Oxytocin 5IU injection", "Obstetric", "2-8C", "standard", 730, 0.03, 12, 20, 2.0),
        ("Paracetamol 500mg (strip of 10)", "Analgesic", "ambient", "standard", 1095, 0.02, 9, 16, 20.0),
        ("Amoxicillin 500mg (strip of 10)", "Antibiotic", "ambient", "standard", 730, 0.03, 45, 70, 8.0),
        ("ORS sachet 21g", "Rehydration", "ambient", "standard", 730, 0.03, 12, 20, 10.0),
        ("Cetirizine 10mg (strip of 10)", "Antihistamine", "ambient", "standard", 1095, 0.02, 10, 18, 9.0),
        ("Pantoprazole 40mg (strip of 10)", "Gastro", "ambient", "standard", 730, 0.02, 40, 65, 9.0),
        ("Azithromycin 500mg (strip of 3)", "Antibiotic", "ambient", "standard", 730, 0.02, 60, 95, 5.0),
        ("Atorvastatin 10mg (strip of 10)", "Cardiac", "ambient", "standard", 1095, 0.02, 35, 58, 7.0),
        ("Vitamin D3 60K sachet", "Supplement", "ambient", "standard", 730, 0.02, 25, 42, 6.0),
    ],
    "grocery": [
        ("Toor dal 1kg", "Pulses", "ambient", "standard", 270, 1.2, 130, 155, 14.0),
        ("Basmati rice 5kg", "Grains", "ambient", "standard", 365, 6.0, 420, 490, 6.0),
        ("Whole wheat atta 5kg", "Grains", "ambient", "standard", 120, 6.5, 210, 245, 9.0),
        ("Sunflower oil 1L", "Edible oil", "ambient", "standard", 270, 1.1, 135, 160, 12.0),
        ("Sugar 1kg", "Staples", "ambient", "standard", 365, 1.0, 42, 50, 16.0),
        ("Tea 250g", "Beverages", "ambient", "standard", 365, 0.5, 110, 135, 8.0),
        ("Glucose biscuits 200g", "Snacks", "ambient", "standard", 180, 0.4, 18, 25, 22.0),
        ("Instant noodles 4-pack", "Snacks", "ambient", "standard", 240, 0.6, 48, 60, 15.0),
        ("Detergent powder 1kg", "Home care", "ambient", "standard", 540, 1.3, 95, 120, 7.0),
        ("Toothpaste 150g", "Personal care", "ambient", "standard", 730, 0.25, 70, 92, 6.0),
        ("Toned milk 500ml", "Dairy", "chilled", "standard", 5, 0.55, 25, 28, 30.0),
        ("Curd 400g", "Dairy", "chilled", "standard", 10, 0.45, 32, 40, 12.0),
        ("Paneer 200g", "Dairy", "chilled", "standard", 12, 0.25, 72, 90, 6.0),
        ("White bread 400g", "Bakery", "ambient", "standard", 5, 1.5, 30, 38, 14.0),
        ("Eggs (tray of 12)", "Poultry", "ambient", "standard", 21, 1.8, 66, 80, 8.0),
    ],
    "cosmetics": [
        ("Daily moisturiser 50ml", "Skincare", "ambient", "standard", 730, 0.08, 180, 299, 9.0),
        ("Sunscreen SPF 50 50ml", "Skincare", "ambient", "standard", 730, 0.08, 220, 399, 8.0),
        ("Neem face wash 100ml", "Skincare", "ambient", "standard", 730, 0.12, 90, 160, 12.0),
        ("Vitamin C serum 30ml", "Skincare", "chilled", "standard", 365, 0.05, 350, 649, 4.0),
        ("Retinol night cream 50ml", "Skincare", "chilled", "standard", 365, 0.08, 420, 799, 3.0),
        ("Fresh clay face mask 100g", "Skincare", "chilled", "standard", 180, 0.12, 160, 299, 3.0),
        ("Matte lipstick", "Makeup", "ambient", "standard", 1095, 0.02, 140, 299, 10.0),
        ("Kajal pencil", "Makeup", "ambient", "standard", 1095, 0.01, 60, 140, 14.0),
        ("Liquid foundation 30ml", "Makeup", "ambient", "standard", 730, 0.05, 260, 499, 5.0),
        ("Nail polish 9ml", "Makeup", "ambient", "standard", 1095, 0.02, 50, 120, 7.0),
        ("Herbal shampoo 200ml", "Haircare", "ambient", "standard", 730, 0.22, 110, 199, 11.0),
        ("Conditioner 200ml", "Haircare", "ambient", "standard", 730, 0.22, 120, 220, 6.0),
        ("Coconut hair oil 200ml", "Haircare", "ambient", "standard", 545, 0.22, 70, 125, 10.0),
        ("Body lotion 400ml", "Bodycare", "ambient", "standard", 730, 0.42, 170, 299, 6.0),
        ("Eau de parfum 50ml", "Fragrance", "ambient", "standard", 1095, 0.12, 650, 1299, 2.0),
    ],
}

# Approximate 2026 festival windows used as a known-calendar feature (synthetic).
FESTIVALS = [
    ("Eid al-Adha", "2026-05-27", "2026-05-28"),
    ("Ganesh Chaturthi", "2026-09-14", "2026-09-18"),
    ("Navratri", "2026-10-11", "2026-10-19"),
    ("Dussehra", "2026-10-20", "2026-10-20"),
    ("Diwali", "2026-11-06", "2026-11-08"),
]

FESTIVAL_UPLIFT = {"pharmacy": (1.0, 1.05), "grocery": (1.35, 1.8), "cosmetics": (1.5, 2.0)}
PROMO_UPLIFT = {"pharmacy": (1.1, 1.2), "grocery": (1.3, 1.6), "cosmetics": (1.3, 1.8)}
WEEKDAY_FACTORS = {
    # Monday .. Sunday
    "pharmacy": [1.08, 1.02, 1.0, 1.0, 1.05, 0.95, 0.70],
    "grocery": [0.90, 0.88, 0.92, 0.98, 1.08, 1.25, 1.20],
    "cosmetics": [0.85, 0.85, 0.9, 0.95, 1.1, 1.35, 1.3],
}

MODULE_SEED_OFFSET = {"pharmacy": 0, "grocery": 1, "cosmetics": 3}
