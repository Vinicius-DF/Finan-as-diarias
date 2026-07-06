/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Initialize Express
const app = express();
app.use(express.json());

const PORT = 3000;

// Initialize GoogleGenAI SDK safely
let ai: GoogleGenAI | null = null;
const geminiKey = process.env.GEMINI_API_KEY;

if (geminiKey) {
  ai = new GoogleGenAI({
    apiKey: geminiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
} else {
  console.warn("⚠️ GEMINI_API_KEY não foi encontrada nas variáveis de ambiente. O assistente usará análises lógicas locais.");
}

/**
 * Endpoint to analyze current finances against the investment goal.
 * Uses Gemini server-side if API key is available, or a smart local logic fallback.
 */
app.post("/api/assistant/evaluate", async (req, res) => {
  try {
    const { earnings = [], bills = [], investmentGoal = 500, timeInfo = {} } = req.body;

    // Perform standard deterministic calculations as context
    const currentYear = timeInfo.year || new Date().getFullYear();
    const currentMonth = timeInfo.month || new Date().getMonth(); // 0-indexed
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const currentDay = timeInfo.day || new Date().getDate();

    const totalEarnings = earnings.reduce((sum: number, e: any) => sum + Number(e.amount), 0);
    const dailyAverage = currentDay > 0 ? totalEarnings / currentDay : 0;

    const totalFixedBills = bills
      .filter((b: any) => b.type === 'fixed')
      .reduce((sum: number, b: any) => sum + Number(b.amount), 0);
    
    const totalCasualBills = bills
      .filter((b: any) => b.type === 'casual')
      .reduce((sum: number, b: any) => sum + Number(b.amount), 0);

    const totalBills = totalFixedBills + totalCasualBills;

    const remainingDays = Math.max(0, daysInMonth - currentDay);
    const projectedEarningsLeft = remainingDays * dailyAverage;
    const expectedTotalEarnings = totalEarnings + projectedEarningsLeft;
    const projectedEndBalance = expectedTotalEarnings - totalBills;

    // Local fallback evaluation data
    const localSuggestions: string[] = [];
    let localAlert: 'success' | 'warning' | 'danger' | 'info' = 'info';
    let localAssessment = "";
    let localViability = "";
    let localCustom = "";

    // Build smart local checks
    const leftOverAfterBillsAndGoal = expectedTotalEarnings - totalBills - investmentGoal;
    
    if (totalEarnings === 0) {
      localAlert = 'info';
      localAssessment = "Você ainda não lançou recebimentos para este mês.";
      localViability = "Lance seus primeiros recebimentos para calibrar sua média diária e avaliar a viabilidade da sua meta.";
      localSuggestions.push(
        "Registre todos os ganhos diários, mesmo os menores, para obter uma projeção de renda fiel.",
        "Liste todas as despesas avulsas previstas para evitar surpresas nas próximas semanas.",
        "Mantenha a meta de investimento visível para programar seus hábitos de gastos."
      );
      localCustom = "Boas-vindas ao seu assistente! Estou pronto para ajudar você a planejar o mês assim que inserir seus primeiros dados.";
    } else {
      if (projectedEndBalance >= investmentGoal) {
        localAlert = 'success';
        localAssessment = `Com ganhos de R$ ${totalEarnings.toFixed(2)} e média diária de R$ ${dailyAverage.toFixed(2)}, você está no caminho certo.`;
        localViability = `Parabéns! Sua projeção de fim de mês é de R$ ${projectedEndBalance.toFixed(2)}, o que cobre perfeitamente sua meta de investimento de R$ ${investmentGoal.toFixed(2)}, restando R$ ${leftOverAfterBillsAndGoal.toFixed(2)} livres.`;
        localSuggestions.push(
          "Aproveite a folga para adiantar o pagamento de alguma conta fixa com desconto, se possível.",
          "Considere direcionar o valor excedente (R$ " + leftOverAfterBillsAndGoal.toFixed(2) + ") para uma reserva de emergência física ou manutenção técnica.",
          "Mantenha o radar de contas avulsas desligado para o restante do mês para garantir este excelente resultado."
        );
        localCustom = "Sensacional! Seu ritmo diário está excelente. Você está dominando a flutuação de caixa variável.";
      } else if (projectedEndBalance >= 0) {
        localAlert = 'warning';
        localAssessment = `Você conseguirá cobrir todas as faturas (R$ ${totalBills.toFixed(2)}), mas a meta de investimento de R$ ${investmentGoal.toFixed(2)} está sob risco.`;
        localViability = `Faltam aproximadamente R$ ${(investmentGoal - projectedEndBalance).toFixed(2)} para atingir sua meta de investimento. Você fechará o mês no positivo por R$ ${projectedEndBalance.toFixed(2)}, mas sem folga.`;
        localSuggestions.push(
          "Evite novas compras parceladas ou custos avulsos até o encerramento do mês corrente.",
          "Tente elevar sua média diária em R$ " + ((investmentGoal - projectedEndBalance) / Math.max(1, remainingDays)).toFixed(2) + " nos próximos " + remainingDays + " dias restantes.",
          "Analise se há contas avulsas que podem ser renegociadas ou adiadas sem juros."
        );
        localCustom = "Quase lá! Um pequeno ajuste nas despesas avulsas ou um dia extra focado em produzir receita ajudará você a bater a meta.";
      } else {
        localAlert = 'danger';
        localAssessment = `Alerta de orçamento apertado: a projeção indica fechamento no vermelho em R$ ${Math.abs(projectedEndBalance).toFixed(2)}.`;
        localViability = `Infelizmente, a meta de investimento é inviável neste cenário. Você precisaria de mais R$ ${(investmentGoal + Math.abs(projectedEndBalance)).toFixed(2)} para cobrir as contas e poupar o valor planejado.`;
        localSuggestions.push(
          "Limite estritamente as compras do tipo 'Contas Avulsas' a emergências médicas ou de trabalho absolutas.",
          "Busque novas oportunidades pontuais para alavancar sua renda diária imediatamente.",
          "Seja criterioso na manutenção e postergue a compra de insumos não cruciais para o próximo mês."
        );
        localCustom = "Momento de foco e disciplina! Na renda variável, dias desafiadores acontecem. Foque em conter a saída de despesas avulsas imediatamente.";
      }
    }

    if (!ai) {
      // Return the smart local rule-based response if Gemini key is missing
      return res.json({
        assessment: localAssessment,
        viability: localViability,
        alertLevel: localAlert,
        suggestions: localSuggestions,
        customMessage: `${localCustom} (Nota: Operando em modo de inteligência local offline)`
      });
    }

    // Call Gemini to get deeper, highly personalized financial insights
    const prompt = `Analise os dados financeiros reais de um autônomo e retorne uma resposta no formato JSON estruturado.
DADOS REAIS:
- Mês atual: ${currentMonth + 1} de ${currentYear}, Dia atual do mês: ${currentDay} de ${daysInMonth} dias totais.
- Renda recebida até agora: R$ ${totalEarnings.toFixed(2)}
- Média diária de recebimento: R$ ${dailyAverage.toFixed(2)}
- Dias restantes: ${remainingDays} dias
- Projeção de ganhos até o fim do mês: R$ ${projectedEarningsLeft.toFixed(2)}
- Total estimado de renda no mês: R$ ${expectedTotalEarnings.toFixed(2)}

DESPESAS:
- Contas Fixas recorrentes (faturamento travado): R$ ${totalFixedBills.toFixed(2)}
- Contas Avulsas (compras pontuais, mdf, ferramentas, etc.): R$ ${totalCasualBills.toFixed(2)}
- Total de Contas do Mês: R$ ${totalBills.toFixed(2)}

METAS DE INVESTIMENTO:
- Meta de poupar/investir neste mês: R$ ${investmentGoal.toFixed(2)}
- Saldo projetado após contas: R$ ${projectedEndBalance.toFixed(2)} (Renda Esperada - Total de Contas)
- Margem livre após pagar contas e tirar a meta: R$ ${leftOverAfterBillsAndGoal.toFixed(2)}

INSTRUÇÕES DA IA:
Aja como um mentor financeiro pessoal brasileiro extremamente direto, sábio e prático. Avalie com precisão a flutuação diária e o impacto das contas avulsas (compras de mdf, ferramentas, peças etc). Retorne o JSON adequado contendo orientações precisas, alertas acionáveis em língua portuguesa natural.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "Você é o 'Previsão & Controle', um consultor financeiro focado em renda variável e autônomos. Você analisa ganhos diários flutuantes, calcula projeções realistas baseadas na média atual e categoriza despesas entre Fixas (obrigatórias e recorrentes) e Avulsas (pontuais/compressíveis). Você sempre responde em JSON rígido traduzido ao português.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            assessment: {
              type: Type.STRING,
              description: "Resumo da saúde financeira atual do mês ligada à média diária do usuário e total recebido."
            },
            viability: {
              type: Type.STRING,
              description: "Explicação em português se a meta de investimento é viável este mês, alertando em relação às contas avulsas em comparação às fixas."
            },
            alertLevel: {
              type: Type.STRING,
              description: "Nível de alerta adequado: 'success' (ótimo/azul), 'info' (aguardando mais dados), 'warning' (atenção equilibrada), ou 'danger' (alto risco/no vermelho)."
            },
            suggestions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Pelo menos 3 conselhos estritamente práticos e acionáveis específicos para melhorar ganhos ou conter faturas avulsas."
            },
            customMessage: {
              type: Type.STRING,
              description: "Uma frase marcante, direta e amigável motivando o profissional autônomo com inteligência emocional."
            }
          },
          required: ["assessment", "viability", "alertLevel", "suggestions", "customMessage"]
        }
      }
    });

    const parsedResponse = JSON.parse(response.text?.trim() || "{}");
    return res.json(parsedResponse);
  } catch (error: any) {
    console.error("Gemini Assistant Error: ", error);
    return res.status(500).json({
      error: "Falha ao avaliar viabilidade financeira.",
      details: error.message
    });
  }
});

// Configure Vite middleware for development or fallback
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

startServer();
