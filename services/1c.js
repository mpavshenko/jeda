const axios = require('axios');

class OneC {
  constructor() {
    this.baseUrl = 'http://ts.jedatools.ru:8080/UT11_Jeda/hs/service';
    this.auth = {
      username: 'hs_service',
      password: '0710'
    };
  }


  /* Result example: 
  [{
    Articul: '14A523',
    Name: 'Щетка проволочная, 240 мм',
    Price: '98,74',
    Amount: 1077
  }]*/
  async getStock() {
    try {
      const response = await axios.get(`${this.baseUrl}/get_stock/`, {
        auth: this.auth
      });
      return response.data[0].Stocks;
    } catch (error) {
      console.error('Error fetching stock from 1C:', error.response?.status, error.response?.statusText);
      throw error;
    }
  }
}

module.exports = OneC;
