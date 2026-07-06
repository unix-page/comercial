const botao = document.getElementById("botaoMensagem");
const mensagem = document.getElementById("mensagem");

botao.addEventListener("click", () => {
  mensagem.textContent = "Funcionou! HTML, CSS e JavaScript estão carregando certinho ✅";
});
