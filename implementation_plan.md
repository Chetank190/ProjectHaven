# Implementation Plan & PRD: Dual-Gateway Care Router

This document combines our **Technical Implementation Plan** with a detailed **Product Requirements Document (PRD)** and a **Data Engineering & Sourcing Audit** for the 7 municipal, clinical, and infrastructure datasets.

---

## 1. Product Requirements Document (PRD)

### User Personas
1.  **Caseworker Clara (Gateway A User):** Conducts field interviews in areas with poor internet connectivity. Needs to copy/paste unstructured interview logs and get an optimized multi-stop resource route for a client immediately.
2.  **Kiosk User Ken (Gateway B User):** A direct citizen in need, potentially facing a digital divide. Needs a high-contrast touch screen at physical terminals to get immediate routing to a single resource (e.g., "Find nearest hot shower") without typing.

### Functional Requirements (FRs)
*   **FR-1: Multi-Location Dual Presentation Gateways**
    *   The app must expose two distinct UI portals: Gateway A (Caseworker) and Gateway B (Kiosk).
    *   Gateway B must support selecting a starting kiosk location from at least 3 pre-configured Toronto hubs or custom input coordinates.
*   **FR-2: Voice-to-Voice Interface (NEW)**
    *   **Speech-to-Text (STT):** The app must support audio input via a microphone. It must capture spoken user queries (e.g., *"I need a place to sleep and some warm food"*) and transcribe them into text.
    *   **Text-to-Speech (TTS):** The app must read the resulting care routing itinerary and directions back to the user aloud.
    *   *Implementation Strategy:* To maintain zero-latency and offline resilience, we will embed browser-native HTML5/JS Web Speech APIs (`SpeechRecognition` and `speechSynthesis`) directly inside Streamlit. This avoids bulky server-side models or cloud API delays.
*   **FR-3: Local NIM Semantic Extraction (NLP)**
    *   The system must parse raw English text (either entered manually or transcribed from voice) and return a structured JSON output of client needs and demographics (e.g., `sector: Youth`, `rehab: true`).
*   **FR-4: Zero-Copy Data Ingestion**
    *   Datasets must be loaded directly into GPU unified memory blocks using RAPIDS `cuDF` to avoid CPU serialization bottlenecks during routing cycles.
*   **FR-5: Capacity & Congestion Balanced Routing**
    *   The routing algorithm must calculate a scoring weight combining absolute distance and current shelter/rehab occupancy ratios.
*   **FR-6: Real-time Performance Benchmarker**
    *   The dashboard must run duplicate CPU (Pandas/Scikit-learn) and GPU (cuDF/cuML) calculation pipelines to report latency (ms) and throughput speedup.
*   **FR-7: Outbound Delivery (SMS/Ticket)**
    *   The app must format route steps into a copyable, low-character text payload that can be sent via SMS or printed as a ticket.
*   **FR-8: Offline Resiliency Fallback**
    *   If Triton NIM/GPU services are offline, the system must toggle to a keyword-matching regex compiler and a CPU pandas parser without crashing.

### Non-Functional Requirements (NFRs)
*   **NFR-1: Ultra-low Latency:** Spatial calculations and array masking on the GPU must execute in `< 10ms` to demonstrate DGX Spark hardware superiority.
*   **NFR-2: Offline Dependency:** Zero network calls to remote AI APIs (like OpenAI) or remote database queries. All data matrices, voice synthesis, and language processing must run locally.
*   **NFR-3: UI Accessibility:** The Kiosk UI must feature a dark-theme, high-contrast, large-font design suitable for outdoor touch displays.

---

## 2. Data Engineering & Sourcing Audit

We analyzed the availability, access methods, and system utilization strategy for all 7 target datasets to ensure compliance with our **Offline-Resilience** criteria:

| # | Data Asset | Source & Availability | Format & Access Method | Hackathon Sourcing Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Daily Shelter Overnight Occupancy** | **Public** (Toronto Open Data) | Live CSV via CKAN API. Updated daily at 4 AM. | Fetch via CKAN API during start, cache locally in `data/shelters.csv` for offline execution. |
| **2** | **Community Services / Drop-In Services** | **Public** (Toronto Open Data) | Periodic CSV. Contains drop-in locations and amenity tags. | Downloaded as static seed and parsed for amenity tags (hot showers, laundry) in `data/hygiene_stations.csv`. |
| **3** | **Daily Meal Programs & Food Banks** | **Public** (Toronto Open Data / SSHA) | Static CSV/JSON directories of active food drops and soup kitchens. | Downloaded as static seed and parsed for operating hours/windows in `data/food_banks.csv`. |
| **4** | **ConnexOntario Program Directory** | **Restricted / Proprietary** (ConnexOntario) | Closed API / Paid access for clinical directory exports. | **Structured Mock Asset:** We will compile a high-fidelity CSV (`data/rehab_services.csv`) reflecting Connex's actual taxonomy (Withdrawal Management, Crisis Stabilization Units, Residential Care) with Toronto coordinates. |
| **5** | **211 Ontario Central Resource Database** | **Restricted / Proprietary** (Ontario 211) | Proprietary AIRS-compliant database requiring official data agreement. | **Grassroots Supplement Asset:** We will compile a high-fidelity static CSV (`data/grassroots_services.csv`) populated with smaller independent food cupboards, warming centers, and street-level clinics. |
| **6** | **OpenStreetMap (OSM) Public Amenities** | **Public & Open** (OSM Foundation) | GeoJSON via Overpass API queries. | Down-selected static GeoJSON of Toronto water fountains, public washrooms, and outdoor charge terminals, cached in `data/osm_amenities.json`. |
| **7** | **TTC Static GTFS** | **Public** (Toronto Transit Commission) | GTFS Zip Archive (`stops.txt`, `routes.txt`). | Pre-load `stops.txt` to map every subway station, streetcar, and bus stop coordinate in Toronto. Used to calculate transit proximity scores. |

---

## 3. Systems Architecture Diagram

```mermaid
graph TD
    subgraph Presentation Layer (Streamlit UI)
        A[Gateway A: Caseworker UI] -->|Caseworker Notes| C[Ingestion Engine]
        B[Gateway B: Kiosk UI] -->|Dropdown / Custom Coord| C
        V[Voice Interface Widget] -->|STT Transcribe| C
        M[Benchmark Panel] -->|Toggle CPU/GPU| C
    end

    subgraph local GPU Services
        C -->|Text Payload| D[Local NVIDIA NIM Llama-3]
        D -->|JSON Needs Output| E[Structured Query]
    end

    subgraph Data & Solver Layer (RAPIDS / Pandas)
        F[(Toronto Open Data CSV Cache)] -->|Zero-Copy cuDF Load| G[Data Matrix]
        E -->|Mask Categories| H[Parallel Matrix Masking]
        G --> H
        H -->|Filtered Coordinates| I[cuML Spatial Solver: KNN]
        I -->|Sub-10ms Route Calculations| J[Capacity Congestion Balancer]
        J -->|Optimal Multi-Stop Path| K[Itinerary Generator]
    end

    K -->|Render Map & Route Info| A
    K -->|Render Map & Route Info| B
    K -->|TTS Audio Output| V
    K -->|SMS / Ticket Generation| L[Outbound Ticket Panel]
```

---

## 4. Directory & File Structure

```
ProjectHaven/
├── data/
│   ├── shelters.csv           # Shelter occupancy, sectors, and locations
│   ├── rehab_services.csv     # Rehab/Detox beds, contact info, and locations
│   ├── food_banks.csv         # Food banks, active hours, and locations
│   ├── grassroots_services.csv# 211 Grassroots supplement services
│   ├── hygiene_stations.csv   # Shower/Laundry locations
│   ├── osm_amenities.json     # OSM Public amenities (washrooms, water, charging)
│   └── stops.txt              # TTC GTFS static stops locations
├── src/
│   ├── __init__.py
│   ├── config.py              # Application settings, kiosk hubs, and API URLs
│   ├── data_ingestion.py      # Zero-Copy RAPIDS Ingestion (cuDF vs. Pandas)
│   ├── nim_compiler.py        # NVIDIA NIM Llama-3 client (with local mock fallback)
│   ├── solver.py              # cuML KNN Solver & Congestion Capacity Balancer
│   └── app.py                 # Streamlit UI + CPU vs GPU Benchmarker + Web Speech HTML Component
├── requirements.txt           # Python packages needed
└── README.md                  # Run guide, architecture, and Spark pitch story
```

---

## 5. Component Technical Specifications

### A. Data Ingestion & Config
*   **[config.py](file:///c:/Users/joysh/Downloads/Haven/ProjectHaven/src/config.py):** Coordinates for kiosk hubs, target data paths, default weights, and local fallback paths.
*   **[data_ingestion.py](file:///c:/Users/joysh/Downloads/Haven/ProjectHaven/src/data_ingestion.py):** Ingests cached CSVs. Under `EngineMode.GPU`, uses `cudf.read_csv()` to bypass CPU boundaries. Under `EngineMode.CPU`, uses `pandas.read_csv()`.

### B. NLP NIM Compiler
*   **[nim_compiler.py](file:///c:/Users/joysh/Downloads/Haven/ProjectHaven/src/nim_compiler.py):** Interfaces structured JSON classifications using a local Llama-3 model hosted via Triton/NIM.

### C. Spatial Solver & Balancer
*   **[solver.py](file:///c:/Users/joysh/Downloads/Haven/ProjectHaven/src/solver.py):**
    *   **Vector Search RAG:** Performs similarity queries on `rehab_services.csv` service descriptions using `cuML` KNN.
    *   **Distance Balancer:** Runs `cuML` KNN to compute Haversine distances to nearest locations, balanced against capacity ratios and transit GTFS station proximity.
    *   **CPU vs GPU Profiler:** Records comparative benchmarks in microseconds.

### D. User Interface & Voice Processing
*   **[app.py](file:///c:/Users/joysh/Downloads/Haven/ProjectHaven/src/app.py):**
    *   Renders dual Streamlit panels.
    *   **Web Speech Integration:** Features an embedded HTML/JS iframe hosting:
        *   `webkitSpeechRecognition` to stream microphone audio directly into text transcribers.
        *   `speechSynthesis` (Web Speech API) to speak the final routing instructions aloud.
    *   Displays routing maps, printable ticket panels, and CPU vs. GPU benchmark dashboards.

---

## 6. Verification Plan

### Automated Verification
*   **Ingestion Verifier:** Checks file validity:
    ```powershell
    python src/data_ingestion.py --verify
    ```
*   **Solver Benchmark:** Profiles spatial calculations:
    ```powershell
    python src/solver.py --benchmark
    ```

### Manual Verification
1.  Launch the dashboard:
    ```powershell
    streamlit run src/app.py
    ```
2.  Enable the **Voice Assistant** switch. Click "Start Recording" and speak: *"I need shelter and hot food."*
3.  Confirm that the transcribed text fills Gateway A or Gateway B automatically.
4.  Confirm that the itinerary outputs are computed, mapped, and read aloud by the speaker system.
