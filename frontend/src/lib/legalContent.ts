// Group 2, item 6. Placeholder legal text -- drafted to be plausible and
// Ethiopia-appropriate (references to Ethiopian consumer-protection and
// data-protection law, ETB, NBE-regulated payment channels) but NOT
// reviewed or approved by counsel. Every page built from this must show
// the "pending legal review" banner (see LegalPage.tsx) and must never be
// presented to a real user/merchant as final without that review.
export interface LegalSection {
  heading: string;
  body: string[];
}

export interface LegalDoc {
  slug: "terms" | "privacy" | "refund-policy";
  title: string;
  lastUpdated: string;
  sections: LegalSection[];
}

const EFFECTIVE_DATE = "2026-01-01";

export const LEGAL_DOCS: Record<LegalDoc["slug"], LegalDoc> = {
  terms: {
    slug: "terms",
    title: "Terms of Service",
    lastUpdated: EFFECTIVE_DATE,
    sections: [
      {
        heading: "1. Acceptance of these Terms",
        body: [
          "These Terms of Service (\"Terms\") govern your access to and use of the Tolo marketplace platform, operated in Ethiopia, connecting customers with independent merchants (\"Merchants\") for the sale and delivery of goods. By creating an account, browsing, or placing an order on Tolo, you agree to be bound by these Terms.",
        ],
      },
      {
        heading: "2. Who We Are",
        body: [
          "Tolo is a marketplace platform. Merchants listed on Tolo are independent businesses responsible for the products they list, their accuracy, and their quality. Tolo facilitates discovery, ordering, payment processing, and delivery coordination, but is not the seller of record for Merchant-listed products unless expressly stated otherwise.",
        ],
      },
      {
        heading: "3. Accounts",
        body: [
          "You must provide accurate information when creating an account and keep your login credentials confidential. You are responsible for all activity under your account. Tolo may suspend or terminate accounts that violate these Terms, engage in fraud, or abuse the platform.",
        ],
      },
      {
        heading: "4. Orders and Payment",
        body: [
          "All prices are shown in Ethiopian Birr (ETB) and include Tolo's commission where applicable. Placing an order is an offer to purchase, which a Merchant may accept or decline. Payment may be made by cash on delivery or through a payment channel regulated by, or consistent with directives of, the National Bank of Ethiopia. Orders are only confirmed once payment is verified (for prepaid methods) or accepted by the Merchant (for cash on delivery).",
        ],
      },
      {
        heading: "5. Delivery",
        body: [
          "Estimated delivery times are approximate and not guaranteed. Delays may occur due to traffic, weather, merchant preparation time, or circumstances beyond Tolo's control. You are responsible for providing an accurate delivery address and being reasonably available to receive your order.",
        ],
      },
      {
        heading: "6. Cancellations, Returns, and Refunds",
        body: [
          "Cancellation and refund eligibility is governed by our Refund Policy, which forms part of these Terms. Some categories of goods (for example, perishable food) may not be eligible for return once prepared or dispatched.",
        ],
      },
      {
        heading: "7. Merchant Conduct",
        body: [
          "Merchants must accurately describe their products, honor listed prices and stock levels, and fulfill accepted orders promptly. Tolo may suspend a Merchant's store for repeated failures to acknowledge or fulfill orders, for misrepresenting products, or for violating applicable Ethiopian consumer-protection law.",
        ],
      },
      {
        heading: "8. Limitation of Liability",
        body: [
          "To the maximum extent permitted by applicable law, Tolo is not liable for indirect, incidental, or consequential damages arising from your use of the platform, a Merchant's conduct, or a delivery delay. Nothing in these Terms limits any liability that cannot be excluded under mandatory Ethiopian consumer-protection law.",
        ],
      },
      {
        heading: "9. Governing Law",
        body: [
          "These Terms are governed by the laws of the Federal Democratic Republic of Ethiopia. Any dispute arising from these Terms is subject to the exclusive jurisdiction of the competent courts of Ethiopia, without prejudice to any mandatory consumer-protection rights you may have.",
        ],
      },
      {
        heading: "10. Changes to these Terms",
        body: [
          "We may update these Terms from time to time. Continued use of Tolo after an update constitutes acceptance of the revised Terms. Material changes will be highlighted on this page.",
        ],
      },
      {
        heading: "11. Contact",
        body: ["Questions about these Terms can be sent through the Support section of the app."],
      },
    ],
  },
  privacy: {
    slug: "privacy",
    title: "Privacy Policy",
    lastUpdated: EFFECTIVE_DATE,
    sections: [
      {
        heading: "1. Who Controls Your Data",
        body: [
          "Tolo (Tech City PLC) is the data controller for personal data collected through the Tolo platform, and processes it in a manner consistent with Ethiopia's data protection principles.",
        ],
      },
      {
        heading: "2. What We Collect",
        body: [
          "Account details you provide (name, phone number, email); delivery addresses; order and payment history (we do not store full payment card or mobile-money credentials — these are handled by the relevant payment channel); device and approximate location information when you use location features; and support/communication records.",
        ],
      },
      {
        heading: "3. How We Use Your Data",
        body: [
          "To process and deliver your orders; to communicate order and account updates (in-app, SMS, or email); to prevent fraud and abuse; to improve the platform; and to comply with applicable Ethiopian legal and regulatory obligations.",
        ],
      },
      {
        heading: "4. Sharing Your Data",
        body: [
          "We share the minimum necessary order details (items, delivery address, contact number) with the Merchant fulfilling your order and, where applicable, the delivery partner. We do not sell your personal data. We may disclose data where required by Ethiopian law or a valid legal process.",
        ],
      },
      {
        heading: "5. Data Retention",
        body: [
          "We retain account and order data for as long as your account is active and for a reasonable period afterward to meet legal, tax, and dispute-resolution obligations, after which it is deleted or anonymized.",
        ],
      },
      {
        heading: "6. Your Rights",
        body: [
          "You may request access to, correction of, or deletion of your personal data, subject to our legitimate need to retain certain records (for example, completed order history for tax purposes). Requests can be made through Account Settings or Support.",
        ],
      },
      {
        heading: "7. Security",
        body: [
          "We apply reasonable technical and organizational measures to protect your data, including row-level access controls and encrypted connections. No system is completely secure, and we encourage you to use a strong, unique password.",
        ],
      },
      {
        heading: "8. Cookies and Similar Technologies",
        body: [
          "The Tolo web apps use local storage and similar technologies to keep you signed in and remember preferences (such as language or theme). These are not used for third-party advertising.",
        ],
      },
      {
        heading: "9. Contact",
        body: ["Privacy questions or data requests can be sent through the Support section of the app."],
      },
    ],
  },
  "refund-policy": {
    slug: "refund-policy",
    title: "Refund Policy",
    lastUpdated: EFFECTIVE_DATE,
    sections: [
      {
        heading: "1. When You're Eligible for a Refund",
        body: [
          "You are generally eligible for a refund when: your order is rejected or cancelled by the Merchant before it is prepared or dispatched and you had already paid; an item you ordered was out of stock and you chose not to accept a substitute; your order does not arrive due to a delivery failure that isn't your fault; or an item arrives damaged, incorrect, or materially different from its listing (subject to review).",
        ],
      },
      {
        heading: "2. Items That May Not Be Refundable",
        body: [
          "Perishable goods (such as prepared food) that were delivered as described generally cannot be returned once accepted, except where the item was damaged, spoiled on arrival, or materially different from what was ordered.",
        ],
      },
      {
        heading: "3. How Refunds Are Issued",
        body: [
          "Automatic refunds: if a Merchant rejects your order, cancels it, or does not respond in time, and you had already paid, a refund is opened automatically for review by our Finance team. Requested refunds: for delivered-order issues, use \"Report a problem\" on the order or contact Support to open a return/refund request.",
        ],
      },
      {
        heading: "4. Refund Method and Timing",
        body: [
          "Refunds are returned to the same payment method used for the order where technically possible, or as store credit/wallet balance where agreed with you. Processing time depends on the original payment channel and is typically completed within a reasonable number of business days after approval.",
        ],
      },
      {
        heading: "5. Delivery Fees",
        body: [
          "Delivery fees are refunded when the order as a whole could not be fulfilled. Where only part of a multi-merchant order is affected, the delivery fee is reviewed on a case-by-case basis.",
        ],
      },
      {
        heading: "6. Disputes",
        body: [
          "If you disagree with a refund decision, you can escalate through Support. This policy does not limit any right you may have under mandatory Ethiopian consumer-protection law.",
        ],
      },
      {
        heading: "7. Contact",
        body: ["Refund questions can be sent through the Support section of the app."],
      },
    ],
  },
};
