# ROOGLE Architecture

This document describes the high-level architecture of ROOGLE, the conversational orchestrator for Unicity Sphere.

## Mermaid Diagram

```mermaid
flowchart TD
    User[User<br/>speaks in plain English<br/>any language] -->|Message| Adapter

    subgraph "Adapters"
        direction LR
        Adapter["Adapter Layer<br/>iframe inside Sphere<br/>or DM bot"]
    end

    Adapter -->|Normalized message| Core["ROOGLE Core<br/>roogle.ts + system prompt"]

    Core --> LLM["LLM Layer<br/>(future: src/agent/llm)"]

    LLM --> Decide{"What should ROOGLE do?"}

    Decide -->|Can handle directly| SelfTools["Self Tools<br/>src/agent/tools/self/"]
    Decide -->|Needs specialist| DiscoveryTools["Discovery Tools<br/>src/agent/tools/discovery/"]

    SelfTools --> ExecuteSelf["Execute Self Tools<br/>get_help, get_balance,<br/>send_simple_message, confirm_action"]

    DiscoveryTools --> SphereDiscovery["Sphere SDK Discovery<br/>search agents in marketplace"]

    SphereDiscovery --> Recommend["Recommend best specialist"]
    Recommend --> PrepareHandoff["Prepare clean context + handoff"]

    ExecuteSelf --> ConfirmationGate
    PrepareHandoff --> ConfirmationGate

    ConfirmationGate{"Involves moving value<br/>or important action?"} -->|Yes| Confirm["Ask for clear confirmation<br/>Explain simply in plain English"]
    ConfirmationGate -->|No| FinalResponse["Send friendly response<br/>to the user"]

    Confirm -->|User says yes| ExecuteOrHandoff["Execute self tool<br/>or complete handoff"]
    Confirm -->|User says no| FinalResponse

    ExecuteOrHandoff --> FinalResponse

    subgraph "Sphere SDK Layer (src/sphere/client.ts)"
        direction TB
        Identity["Agent Identity + Wallet"]
        Messaging["Messaging<br/>DMs & Groups"]
        Discovery["Agent Discovery & Marketplace"]
        Identity & Messaging & Discovery
    end

    Core -.-> Sphere["SphereClient"]
    SphereDiscovery -.-> Sphere
    Sphere -.-> Identity
    Sphere -.-> Messaging
    Sphere -.-> Discovery

    style User fill:#e0f2fe
    style Core fill:#fef3c7
    style ConfirmationGate fill:#fee2e2
```

## Key Components & Data Flow

- **User** speaks naturally in plain English. No commands or special syntax required.

- **Adapters** (iframe or DM) receive the message from the Sphere environment and pass a normalized message into the core agent. The core logic stays the same regardless of how the user is talking to ROOGLE.

- **ROOGLE Core** (`roogle.ts`) + the permanent **System Prompt** is the decision-making brain. It decides between:
  - Self Tools (get_help, get_balance, send_simple_message, confirm_action — handle directly and safely)
  - Discovery Tools (later phases — find and route to a specialist)

- **Sphere SDK Layer** (`sphere/client.ts`) gives ROOGLE its identity, wallet, messaging capabilities, and access to the agent marketplace for discovery.

- **Safety Gate (Confirmation)**: Before any action that moves value or makes important changes, ROOGLE must explain in plain language what will happen and get explicit user approval.

This architecture keeps ROOGLE simple for users while allowing it to intelligently orchestrate the full power of the Unicity Sphere ecosystem.
